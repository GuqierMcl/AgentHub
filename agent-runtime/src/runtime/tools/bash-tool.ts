import { stat, realpath } from "node:fs/promises"
import { basename, isAbsolute, relative, resolve } from "node:path"
import { execa } from "execa"
import { z } from "zod"
import type { BashPermissionAction, BashPermissionRules } from "../../agents"
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

type ResolvedShell = {
  executable: string
  commandArgs: string[]
  displayName: string
}

type RuleMatch = {
  pattern: string
  action: BashPermissionAction
}

type OutputCapture = {
  bytes: number
  truncated: boolean
}

type OutputBudget = {
  remainingBytes: number
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
      "bash is unavailable because this run has no bound workspace"
    )
  }

  const logicalInput = normalizeWorkspacePath(cwdInput)
  if (isAbsolute(logicalInput)) {
    return createFailure<BashResult>(
      "BASH_INVALID_CWD",
      "bash cwd must be relative to the bound workspace",
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
      "The bound workspace root no longer exists"
    )
  }

  const candidate = resolve(rootPath, logicalInput)
  let actualCwd: string
  try {
    actualCwd = await realpath(candidate)
  } catch {
    return createFailure<BashResult>(
      "WORKSPACE_PATH_NOT_FOUND",
      `bash cwd ${logicalInput} does not exist`,
      {
        cwd: logicalInput,
      }
    )
  }

  if (!isWithinPath(actualCwd, rootPath)) {
    return createFailure<BashResult>(
      "WORKSPACE_PATH_OUTSIDE_ROOT",
      "bash cwd must stay inside the bound workspace",
      {
        cwd: logicalInput,
      }
    )
  }

  const cwdStat = await stat(actualCwd).catch(() => null)
  if (!cwdStat?.isDirectory()) {
    return createFailure<BashResult>(
      "WORKSPACE_NOT_A_DIRECTORY",
      `bash cwd ${logicalInput} is not a directory`,
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

function parseJsonStringArray(value: string | undefined): string[] | null {
  if (!value?.trim()) {
    return null
  }

  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed
    }
  } catch {
    return null
  }

  return null
}

function defaultShellArgs(): string[] {
  return process.platform === "win32"
    ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"]
    : ["-lc"]
}

function resolveShell(): ResolvedShell {
  const override = process.env.AGENTHUB_BASH_SHELL?.trim()
  if (override) {
    return {
      executable: override,
      commandArgs: parseJsonStringArray(process.env.AGENTHUB_BASH_SHELL_ARGS) ?? defaultShellArgs(),
      displayName: basename(override) || override,
    }
  }

  if (process.platform === "win32") {
    return {
      executable: "powershell.exe",
      commandArgs: defaultShellArgs(),
      displayName: "powershell.exe",
    }
  }

  return {
    executable: "/bin/sh",
    commandArgs: defaultShellArgs(),
    displayName: "/bin/sh",
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

function createDeniedResult(input: BashInput, match: RuleMatch, shell: ResolvedShell): ToolExecutionResult<BashResult> {
  return createFailure<BashResult>(
    "BASH_COMMAND_DENIED",
    `bash command denied by rule "${match.pattern}"`,
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

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return ""
  }

  let bytes = 0
  let output = ""
  for (const char of value) {
    const nextBytes = Buffer.byteLength(char, "utf8")
    if (bytes + nextBytes > maxBytes) {
      break
    }
    bytes += nextBytes
    output += char
  }
  return output
}

function createOutputTransform(
  capture: OutputCapture,
  budget: OutputBudget
): (chunk: unknown) => Generator<unknown, void, void> {
  return function* captureChunk(chunk: unknown): Generator<unknown, void, void> {
    const text = typeof chunk === "string" ? chunk : String(chunk)
    if (budget.remainingBytes <= 0) {
      capture.truncated = true
      return
    }

    const chunkBytes = Buffer.byteLength(text, "utf8")
    const availableBytes = budget.remainingBytes
    if (chunkBytes <= availableBytes) {
      capture.bytes += chunkBytes
      budget.remainingBytes -= chunkBytes
      yield text
      return
    }

    const truncatedText = truncateUtf8(text, availableBytes)
    const truncatedBytes = Buffer.byteLength(truncatedText, "utf8")
    capture.bytes += truncatedBytes
    budget.remainingBytes -= truncatedBytes
    capture.truncated = true
    if (truncatedText) {
      yield truncatedText
    }
  }
}

function toOutputString(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(toOutputString).join("")
  }
  if (value instanceof Uint8Array) {
    return new TextDecoder("utf-8").decode(value)
  }
  return value === undefined || value === null ? "" : String(value)
}

function capOutputText(value: string, maxBytes: number): { text: string; bytes: number; truncated: boolean } {
  const bytes = Buffer.byteLength(value, "utf8")
  if (bytes <= maxBytes) {
    return {
      text: value,
      bytes,
      truncated: false,
    }
  }

  const text = truncateUtf8(value, maxBytes)
  return {
    text,
    bytes: Buffer.byteLength(text, "utf8"),
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
      const shell = resolveShell()
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
      const shell = resolveShell()
      const cwdResolution = await resolveWorkspaceCwd(context, input.cwd)
      if (!("actualCwd" in cwdResolution)) {
        return cwdResolution
      }

      const startedAt = Date.now()
      const stdoutCapture: OutputCapture = { bytes: 0, truncated: false }
      const stderrCapture: OutputCapture = { bytes: 0, truncated: false }
      const outputBudget: OutputBudget = { remainingBytes: input.maxOutputBytes }

      try {
        const result = await execa(shell.executable, [...shell.commandArgs, input.command], {
          cwd: cwdResolution.actualCwd,
          env: createShellEnv(),
          extendEnv: false,
          reject: false,
          timeout: input.timeoutMs,
          cancelSignal: context.signal,
          stdin: "ignore",
          stdout: createOutputTransform(stdoutCapture, outputBudget),
          stderr: createOutputTransform(stderrCapture, outputBudget),
          stripFinalNewline: false,
          windowsHide: true,
          maxBuffer: MAX_OUTPUT_BYTES + 16_384,
        })

        const durationMs = Date.now() - startedAt
        let remainingBytes = input.maxOutputBytes
        const stdoutOutput = capOutputText(toOutputString(result.stdout), remainingBytes)
        remainingBytes -= stdoutOutput.bytes
        const stderrOutput = capOutputText(toOutputString(result.stderr), Math.max(0, remainingBytes))
        const data = createResultData(input, cwdResolution.logicalCwd, shell.displayName, {
          exitCode: typeof result.exitCode === "number" ? result.exitCode : null,
          signal: result.signal ?? null,
          stdout: stdoutOutput.text,
          stderr: stderrOutput.text,
          stdoutBytes: stdoutOutput.bytes,
          stderrBytes: stderrOutput.bytes,
          truncated: stdoutCapture.truncated || stderrCapture.truncated || stdoutOutput.truncated || stderrOutput.truncated,
          durationMs,
        })

        if (context.signal.aborted || result.isCanceled) {
          return createFailure<BashResult>(
            "TOOL_EXECUTION_ABORTED",
            "bash command was cancelled",
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
            `bash command timed out after ${input.timeoutMs}ms`,
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
            `bash output exceeded the internal max buffer`,
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
          summary: `bash exited with code ${data.exitCode ?? "unknown"}`,
          data,
        }
      } catch (error) {
        const durationMs = Date.now() - startedAt
        const partial = createResultData(input, cwdResolution.logicalCwd, shell.displayName, {
          durationMs,
          truncated: stdoutCapture.truncated || stderrCapture.truncated,
        })
        if (context.signal.aborted) {
          return createFailure<BashResult>(
            "TOOL_EXECUTION_ABORTED",
            "bash command was cancelled",
            {
              command: input.command,
              cwd: cwdResolution.logicalCwd,
            },
            partial,
            "cancelled"
          )
        }

        const message = error instanceof Error ? error.message : "bash command failed"
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
