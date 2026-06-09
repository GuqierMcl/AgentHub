import { execFileSync } from "node:child_process"
import { stat, realpath } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import { execa } from "execa"
import { z } from "zod"
import type { BashPermissionAction, BashPermissionRules } from "../../agents"
import { createShellCommand, resolveRuntimeShell, type ResolvedRuntimeShell } from "../shell-resolver"
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "./types"

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 300_000
const DEFAULT_MAX_OUTPUT_BYTES = 131_072
const MAX_OUTPUT_BYTES = 1_048_576
const FALLBACK_BASH_PERMISSION_RULES: BashPermissionRules = {
  "*": "ask",
}

const WINDOWS_ENV_ALLOWLIST = new Set([
  "ALLUSERSPROFILE",
  "APPDATA",
  "COMSPEC",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "PSMODULEPATH",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERDOMAIN",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
])

const POSIX_ENV_ALLOWLIST = new Set([
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USER",
])

export const BashInputSchema = z.object({
  command: z.string().trim().min(1).max(20_000),
  cwd: z.string().trim().max(1_000).optional(),
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional().default(DEFAULT_TIMEOUT_MS),
  maxOutputBytes: z.number().int().positive().max(MAX_OUTPUT_BYTES).optional().default(DEFAULT_MAX_OUTPUT_BYTES),
  description: z.string().trim().min(1).max(1_000).optional(),
}).strict()

export type BashInput = z.infer<typeof BashInputSchema>

export type BashResult = {
  command: string
  cwd: string
  shell: string
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  stdoutBytes: number
  stderrBytes: number
  truncated: boolean
  durationMs: number
}

type ResolvedCwd = {
  actualCwd: string
  logicalCwd: string
}

type RuleMatch = {
  pattern: string
  action: BashPermissionAction
}

function createFailure<TData = unknown>(
  code: string,
  message: string,
  details?: unknown,
  data?: TData,
  status: "failed" | "cancelled" = "failed"
): ToolExecutionResult<TData> {
  return {
    status,
    summary: message,
    ...(data === undefined ? {} : { data }),
    error: {
      code,
      message,
      details,
    },
  }
}

function normalizeWorkspacePath(pathValue: string | undefined): string {
  const trimmed = pathValue?.trim()
  if (!trimmed) {
    return "."
  }

  return trimmed.replaceAll("\\", "/")
}

function normalizeComparisonPath(pathValue: string): string {
  const normalized = resolve(pathValue)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function isWithinPath(candidatePath: string, rootPath: string): boolean {
  const candidate = normalizeComparisonPath(candidatePath)
  const root = normalizeComparisonPath(rootPath)
  if (candidate === root) {
    return true
  }

  const relativePath = relative(root, candidate)
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath)
}

function toLogicalPath(pathValue: string, rootPath: string): string {
  const relativePath = relative(rootPath, pathValue)
  return relativePath ? relativePath.replaceAll("\\", "/") : "."
}

async function resolveWorkspaceCwd(
  context: ToolExecutionContext,
  cwdInput: string | undefined
): Promise<ResolvedCwd | ToolExecutionResult<BashResult>> {
  const handle = context.workspaceService?.getHandle()
  if (!handle) {
    return createFailure<BashResult>(
      "WORKSPACE_NOT_BOUND",
      "bash 不可用，因为此运行没有绑定工作区"
    )
  }

  const logicalInput = normalizeWorkspacePath(cwdInput)
  if (isAbsolute(logicalInput)) {
    return createFailure<BashResult>(
      "BASH_INVALID_CWD",
      "bash 工作目录必须相对于绑定的工作区",
      {
        cwd: logicalInput,
      }
    )
  }

  let rootPath: string
  try {
    rootPath = await realpath(handle.rootPath)
  } catch {
    return createFailure<BashResult>(
      "WORKSPACE_PATH_NOT_FOUND",
      "绑定的工作区根目录已不存在"
    )
  }

  const candidate = resolve(rootPath, logicalInput)
  let actualCwd: string
  try {
    actualCwd = await realpath(candidate)
  } catch {
    return createFailure<BashResult>(
      "WORKSPACE_PATH_NOT_FOUND",
      `bash 工作目录 ${logicalInput} 不存在`,
      {
        cwd: logicalInput,
      }
    )
  }

  if (!isWithinPath(actualCwd, rootPath)) {
    return createFailure<BashResult>(
      "WORKSPACE_PATH_OUTSIDE_ROOT",
      "bash 工作目录必须在绑定的工作区内",
      {
        cwd: logicalInput,
      }
    )
  }

  const cwdStat = await stat(actualCwd).catch(() => null)
  if (!cwdStat?.isDirectory()) {
    return createFailure<BashResult>(
      "WORKSPACE_NOT_A_DIRECTORY",
      `bash 工作目录 ${logicalInput} 不是目录`,
      {
        cwd: logicalInput,
      }
    )
  }

  return {
    actualCwd,
    logicalCwd: toLogicalPath(actualCwd, rootPath),
  }
}

function createShellEnv(): Record<string, string> {
  const allowlist = process.platform === "win32"
    ? WINDOWS_ENV_ALLOWLIST
    : POSIX_ENV_ALLOWLIST
  const env: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (!value) {
      continue
    }

    const normalizedKey = process.platform === "win32" ? key.toUpperCase() : key
    if (allowlist.has(normalizedKey)) {
      env[key] = value
    }
  }

  env.NO_COLOR = "1"
  env.CI = process.env.CI ?? "1"
  return env
}

function normalizeCommandForRules(command: string): string {
  return command.trim().replace(/\s+/g, " ")
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp(`^${escaped}$`, "i")
}

function matchBashRule(rules: BashPermissionRules | undefined, command: string): RuleMatch {
  const entries = Object.entries(
    rules && Object.keys(rules).length > 0 ? rules : FALLBACK_BASH_PERMISSION_RULES
  )
  const normalizedCommand = normalizeCommandForRules(command)
  let match: RuleMatch | null = null

  for (const [pattern, action] of entries) {
    if (wildcardToRegExp(normalizeCommandForRules(pattern)).test(normalizedCommand)) {
      match = { pattern, action }
    }
  }

  return match ?? { pattern: "*", action: "ask" }
}

function isApprovedToolCall(context: ToolExecutionContext): boolean {
  const request = context.permissionService?.getRequestForToolCall(context.runId, context.toolCallId)
  return request?.status === "approved"
}

function createDeniedResult(input: BashInput, match: RuleMatch, shell: ResolvedRuntimeShell): ToolExecutionResult<BashResult> {
  return createFailure<BashResult>(
    "BASH_COMMAND_DENIED",
    `bash 命令被规则 "${match.pattern}" 拒绝`,
    {
      command: input.command,
      cwd: normalizeWorkspacePath(input.cwd),
      matchedRule: match.pattern,
      ruleAction: match.action,
      shell: shell.displayName,
    }
  )
}

function describeCommand(command: string): string {
  const normalized = command.replace(/\s+/g, " ").trim()
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized
}

function toOutputBuffer(value: unknown): Buffer {
  if (typeof value === "string") {
    return Buffer.from(value, "latin1")
  }
  if (Array.isArray(value)) {
    return Buffer.concat(value.map(toOutputBuffer))
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value)
  }
  return value === undefined || value === null ? Buffer.alloc(0) : Buffer.from(String(value), "utf8")
}

function decodeStrict(buffer: Buffer, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buffer)
  } catch {
    return null
  }
}

function decodeLenient(buffer: Buffer, encoding: string): string | null {
  try {
    return new TextDecoder(encoding).decode(buffer)
  } catch {
    return null
  }
}

let cachedWindowsAnsiEncoding: string | null | undefined

function getWindowsAnsiEncoding(): string | null {
  if (process.platform !== "win32") {
    return null
  }
  if (cachedWindowsAnsiEncoding !== undefined) {
    return cachedWindowsAnsiEncoding
  }

  const configuredCodePage = process.env.AGENTHUB_BASH_WINDOWS_CODE_PAGE?.trim()
  const codePage = configuredCodePage && /^\d+$/.test(configuredCodePage)
    ? Number.parseInt(configuredCodePage, 10)
    : detectWindowsAnsiCodePage()
  cachedWindowsAnsiEncoding = codePage ? mapWindowsCodePageEncoding(codePage) : fallbackWindowsLocaleEncoding()
  return cachedWindowsAnsiEncoding
}

function detectWindowsAnsiCodePage(): number | null {
  try {
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "[System.Text.Encoding]::Default.CodePage"],
      {
        encoding: "buffer",
        timeout: 1_000,
        windowsHide: true,
      }
    )
    const match = Buffer.from(output).toString("ascii").match(/\d+/)
    return match ? Number.parseInt(match[0], 10) : null
  } catch {
    return null
  }
}

function mapWindowsCodePageEncoding(codePage: number): string | null {
  const explicit = new Map<number, string>([
    [65001, "utf-8"],
    [936, "gb18030"],
    [54936, "gb18030"],
    [950, "big5"],
    [932, "shift_jis"],
    [949, "euc-kr"],
    [1252, "windows-1252"],
  ])
  const mapped = explicit.get(codePage)
  if (mapped) {
    return mapped
  }
  if (codePage >= 1250 && codePage <= 1258) {
    return `windows-${codePage}`
  }
  return null
}

function fallbackWindowsLocaleEncoding(): string | null {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase()
  if (locale.startsWith("zh")) return "gb18030"
  if (locale.startsWith("ja")) return "shift_jis"
  if (locale.startsWith("ko")) return "euc-kr"
  return "windows-1252"
}

function outputEncodingCandidates(): string[] {
  const candidates = [
    process.env.AGENTHUB_BASH_OUTPUT_ENCODING?.trim(),
    "utf-8",
    getWindowsAnsiEncoding(),
  ].filter((encoding): encoding is string => Boolean(encoding))
  return [...new Set(candidates.map((encoding) => encoding.toLowerCase()))]
}

function decodeOutputBuffer(buffer: Buffer): string {
  if (buffer.byteLength === 0) {
    return ""
  }

  const candidates = outputEncodingCandidates()
  for (const encoding of candidates) {
    const decoded = decodeStrict(buffer, encoding)
    if (decoded !== null) {
      return decoded
    }
  }

  for (const encoding of candidates) {
    const decoded = decodeLenient(buffer, encoding)
    if (decoded !== null) {
      return decoded
    }
  }

  return buffer.toString("utf8")
}

function capOutputBuffer(value: Buffer, maxBytes: number): { text: string; bytes: number; truncated: boolean } {
  if (value.byteLength <= maxBytes) {
    return {
      text: decodeOutputBuffer(value),
      bytes: value.byteLength,
      truncated: false,
    }
  }

  const capped = value.subarray(0, Math.max(0, maxBytes))
  return {
    text: decodeOutputBuffer(capped),
    bytes: capped.byteLength,
    truncated: true,
  }
}

function createResultData(input: BashInput, cwd: string, shell: string, partial: Partial<BashResult> = {}): BashResult {
  return {
    command: input.command,
    cwd,
    shell,
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "",
    stdoutBytes: 0,
    stderrBytes: 0,
    truncated: false,
    durationMs: 0,
    ...partial,
  }
}

export function createBashTool(): ToolDefinition<BashInput, BashResult> {
  return {
    name: "bash",
    displayName: "Bash",
    description: "在绑定工作区中通过平台 shell 执行非交互式命令，并返回截断后的 stdout/stderr。",
    category: "shell",
    inputSchema: BashInputSchema,
    riskLevel: "high",
    requiredPermissions: {
      shell: "limited",
    },
    approvalPolicy: "contextual",
    configurableByUserAgent: false,
    prepareExecution: async (input, context) => {
      const shell = resolveRuntimeShell()
      const match = matchBashRule(context.agent.toolPermissionRules?.bash, input.command)

      if (match.action === "deny") {
        return {
          type: "deny",
          result: createDeniedResult(input, match, shell),
        }
      }

      if (match.action === "allow" || isApprovedToolCall(context)) {
        return { type: "allow" }
      }

      return {
        type: "ask",
        approval: {
          reason: input.description ??
            `${context.agent.name} wants to run: ${describeCommand(input.command)}`,
          riskLevel: "high",
          data: {
            permissionType: "command_execute",
            approvalReason: "bash_command",
            command: input.command,
            cwd: normalizeWorkspacePath(input.cwd),
            matchedRule: match.pattern,
            ruleAction: match.action,
            shell: shell.displayName,
          },
        },
      }
    },
    async execute(input, context) {
      const shell = resolveRuntimeShell()
      const cwdResolution = await resolveWorkspaceCwd(context, input.cwd)
      if (!("actualCwd" in cwdResolution)) {
        return cwdResolution
      }

      const startedAt = Date.now()

      try {
        const result = await execa(shell.executable, [...shell.commandArgs, createShellCommand(shell, input.command)], {
          cwd: cwdResolution.actualCwd,
          env: createShellEnv(),
          extendEnv: false,
          encoding: "latin1",
          reject: false,
          timeout: input.timeoutMs,
          cancelSignal: context.signal,
          stdin: "ignore",
          stripFinalNewline: false,
          windowsHide: true,
          maxBuffer: MAX_OUTPUT_BYTES + 16_384,
        })

        const durationMs = Date.now() - startedAt
        let remainingBytes = input.maxOutputBytes
        const stdoutOutput = capOutputBuffer(toOutputBuffer(result.stdout), remainingBytes)
        remainingBytes -= stdoutOutput.bytes
        const stderrOutput = capOutputBuffer(toOutputBuffer(result.stderr), Math.max(0, remainingBytes))
        const data = createResultData(input, cwdResolution.logicalCwd, shell.displayName, {
          exitCode: typeof result.exitCode === "number" ? result.exitCode : null,
          signal: result.signal ?? null,
          stdout: stdoutOutput.text,
          stderr: stderrOutput.text,
          stdoutBytes: stdoutOutput.bytes,
          stderrBytes: stderrOutput.bytes,
          truncated: stdoutOutput.truncated || stderrOutput.truncated,
          durationMs,
        })

        if (context.signal.aborted || result.isCanceled) {
          return createFailure<BashResult>(
            "TOOL_EXECUTION_ABORTED",
            "bash 命令已取消",
            {
              command: input.command,
              cwd: cwdResolution.logicalCwd,
            },
            data,
            "cancelled"
          )
        }

        if (result.timedOut) {
          return createFailure<BashResult>(
            "BASH_TIMEOUT",
            `bash 命令在 ${input.timeoutMs}ms 后超时`,
            {
              command: input.command,
              cwd: cwdResolution.logicalCwd,
              timeoutMs: input.timeoutMs,
            },
            data
          )
        }

        if (result.isMaxBuffer) {
          return createFailure<BashResult>(
            "BASH_OUTPUT_TOO_LARGE",
            `bash 输出超出内部缓冲区上限`,
            {
              command: input.command,
              cwd: cwdResolution.logicalCwd,
              maxOutputBytes: input.maxOutputBytes,
            },
            {
              ...data,
              truncated: true,
            }
          )
        }

        if (result.failed && result.exitCode === undefined && !result.signal) {
          const message = result.shortMessage ?? result.message ?? "bash command failed to start"
          return createFailure<BashResult>(
            "BASH_SPAWN_FAILED",
            message,
            {
              command: input.command,
              cwd: cwdResolution.logicalCwd,
              code: result.code,
            },
            data
          )
        }

        return {
          status: "completed",
          summary: `bash 退出，代码 ${data.exitCode ?? "未知"}`,
          data,
        }
      } catch (error) {
        const durationMs = Date.now() - startedAt
        const partial = createResultData(input, cwdResolution.logicalCwd, shell.displayName, {
          durationMs,
        })
        if (context.signal.aborted) {
          return createFailure<BashResult>(
            "TOOL_EXECUTION_ABORTED",
            "bash 命令已取消",
            {
              command: input.command,
              cwd: cwdResolution.logicalCwd,
            },
            partial,
            "cancelled"
          )
        }

        const message = error instanceof Error ? error.message : "bash 命令执行失败"
        return createFailure<BashResult>(
          "BASH_EXECUTION_FAILED",
          message,
          {
            command: input.command,
            cwd: cwdResolution.logicalCwd,
          },
          partial
        )
      }
    },
  }
}
