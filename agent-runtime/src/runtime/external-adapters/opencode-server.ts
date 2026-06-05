import { spawn, type ChildProcessByStdio } from "node:child_process"
import { realpath } from "node:fs/promises"
import { createServer } from "node:net"
import { normalize, resolve } from "node:path"
import { platform } from "node:os"
import type { Readable } from "node:stream"
import {
  createOpencode,
  createOpencodeClient,
  type OpencodeClient,
  type Path as OpenCodePath,
  type Project,
} from "@opencode-ai/sdk/v2"
import { createChildLogger } from "../../logger"
import { ExternalAdapterError, type ExternalAdapterErrorCode } from "./types"

export type OpenCodeConnectionMode = "managed-by-runtime" | "existing-local-server"

export type OpenCodeManagedServerLifecycleStatus = "idle" | "starting" | "running" | "error"

export type OpenCodeManagedServerStatus = {
  status: OpenCodeManagedServerLifecycleStatus
  mode: OpenCodeConnectionMode
  activeWorkspaceCount: number
  pendingWorkspaceCount: number
  lastError?: unknown
}

export type OpenCodeApiClient = Pick<OpencodeClient, "project" | "path" | "session" | "provider" | "event" | "permission">

export type OpenCodeServerHandle = {
  url: string
  close(): void | Promise<void>
}

export type OpenCodeWorkspaceConnection = {
  mode: "managed-by-runtime"
  client: OpenCodeApiClient
  directory: string
  server: OpenCodeServerHandle
  close(): Promise<void>
}

export type OpenCodeSdkWorkspaceOption = "cwd" | "workdir" | "projectPath"

export type OpenCodeSdkManagedFactory = (options: Record<string, unknown>) => Promise<{
  client: OpenCodeApiClient
  server: OpenCodeServerHandle
}>

export type OpenCodeClientFactory = (config: {
  baseUrl: string
  directory: string
}) => OpenCodeApiClient

export type OpenCodeManagedProcess = ChildProcessByStdio<null, Readable, Readable>

export type OpenCodeProcessLauncher = (
  command: string,
  args: string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    windowsHide: boolean
    stdio: ["ignore", "pipe", "pipe"]
  }
) => OpenCodeManagedProcess

export type ManagedOpenCodeServerDependencies = {
  hostname?: string
  startupTimeoutMs?: number
  allocatePort?: () => Promise<number>
  createSdkManaged?: OpenCodeSdkManagedFactory
  resolveSdkWorkspaceOption?: () => OpenCodeSdkWorkspaceOption | null
  createClient?: OpenCodeClientFactory
  launchProcess?: OpenCodeProcessLauncher
}

const DEFAULT_HOSTNAME = "127.0.0.1"
const DEFAULT_STARTUP_TIMEOUT_MS = 5_000
const MAX_STARTUP_OUTPUT_CHARS = 32_768
const log = createChildLogger("opencode-server")

export class ManagedOpenCodeServer {
  private readonly hostname: string
  private readonly startupTimeoutMs: number
  private readonly allocatePort: () => Promise<number>
  private readonly createSdkManaged: OpenCodeSdkManagedFactory
  private readonly resolveSdkWorkspaceOption: () => OpenCodeSdkWorkspaceOption | null
  private readonly createClient: OpenCodeClientFactory
  private readonly launchProcess: OpenCodeProcessLauncher
  private readonly connections = new Map<string, OpenCodeWorkspaceConnection>()
  private readonly pending = new Map<string, Promise<OpenCodeWorkspaceConnection>>()
  private lastError: unknown
  private cleanupRegistered = false

  constructor(dependencies: ManagedOpenCodeServerDependencies = {}) {
    this.hostname = dependencies.hostname ?? DEFAULT_HOSTNAME
    this.startupTimeoutMs = dependencies.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
    this.allocatePort = dependencies.allocatePort ?? allocateTcpPort
    this.createSdkManaged = dependencies.createSdkManaged ?? defaultCreateSdkManaged
    this.resolveSdkWorkspaceOption = dependencies.resolveSdkWorkspaceOption ?? detectOpenCodeSdkWorkspaceOption
    this.createClient = dependencies.createClient ?? defaultCreateClient
    this.launchProcess = dependencies.launchProcess ?? defaultLaunchProcess
  }

  async ensure(workspaceRootPath: string): Promise<OpenCodeWorkspaceConnection> {
    const workspaceRoot = await canonicalizePath(workspaceRootPath)
    const existing = this.connections.get(workspaceRoot)
    if (existing) {
      log.info(
        {
          externalProvider: "opencode",
          workspaceRoot,
          mode: existing.mode,
          serverUrl: existing.server.url,
        },
        "OpenCode workspace connection reused"
      )
      return existing
    }

    const pending = this.pending.get(workspaceRoot)
    if (pending) {
      log.info(
        {
          externalProvider: "opencode",
          workspaceRoot,
        },
        "OpenCode workspace connection startup already pending"
      )
      return pending
    }

    log.info(
      {
        externalProvider: "opencode",
        workspaceRoot,
      },
      "OpenCode workspace connection starting"
    )
    const next = this.start(workspaceRoot)
      .then((connection) => {
        this.connections.set(workspaceRoot, connection)
        this.lastError = undefined
        this.registerProcessCleanup()
        log.info(
          {
            externalProvider: "opencode",
            workspaceRoot,
            mode: connection.mode,
            serverUrl: connection.server.url,
          },
          "OpenCode workspace connection ready"
        )
        return connection
      })
      .catch((error) => {
        this.lastError = sanitizeStatusError(error)
        throw error
      })
      .finally(() => {
        this.pending.delete(workspaceRoot)
      })
    this.pending.set(workspaceRoot, next)
    return next
  }

  getStatus(): OpenCodeManagedServerStatus {
    const activeWorkspaceCount = this.connections.size
    const pendingWorkspaceCount = this.pending.size
    const status: OpenCodeManagedServerLifecycleStatus = pendingWorkspaceCount > 0
      ? "starting"
      : activeWorkspaceCount > 0
        ? "running"
        : this.lastError
          ? "error"
          : "idle"

    return {
      status,
      mode: "managed-by-runtime",
      activeWorkspaceCount,
      pendingWorkspaceCount,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    }
  }

  async closeAll(): Promise<void> {
    const connections = Array.from(this.connections.values())
    log.info(
      {
        externalProvider: "opencode",
        connectionCount: connections.length,
      },
      "OpenCode closing all managed workspace connections"
    )
    this.connections.clear()
    this.pending.clear()
    await Promise.allSettled(connections.map((connection) => connection.close()))
  }

  private async start(workspaceRoot: string): Promise<OpenCodeWorkspaceConnection> {
    const workspaceOption = this.resolveSdkWorkspaceOption()
    if (workspaceOption) {
      log.info(
        {
          externalProvider: "opencode",
          workspaceRoot,
          workspaceOption,
        },
        "OpenCode SDK managed server selected"
      )
      return this.startSdkManaged(workspaceRoot, workspaceOption)
    }

    log.info(
      {
        externalProvider: "opencode",
        workspaceRoot,
      },
      "OpenCode CLI managed server selected"
    )
    return this.startCliManaged(workspaceRoot)
  }

  private async startSdkManaged(
    workspaceRoot: string,
    workspaceOption: OpenCodeSdkWorkspaceOption
  ): Promise<OpenCodeWorkspaceConnection> {
    const port = await this.allocatePort()
    const abortController = new AbortController()
    let handle: OpenCodeServerHandle | undefined

    try {
      log.info(
        {
          externalProvider: "opencode",
          workspaceRoot,
          hostname: this.hostname,
          port,
          workspaceOption,
        },
        "OpenCode SDK managed server starting"
      )
      const managed = await this.createSdkManaged({
        hostname: this.hostname,
        port,
        signal: abortController.signal,
        timeout: this.startupTimeoutMs,
        [workspaceOption]: workspaceRoot,
      })
      handle = managed.server
      await this.validateWorkspace(managed.client, workspaceRoot)
      log.info(
        {
          externalProvider: "opencode",
          workspaceRoot,
          serverUrl: managed.server.url,
        },
        "OpenCode SDK managed server validated"
      )
      return this.createConnection(workspaceRoot, managed.client, managed.server, () => {
        abortController.abort()
      })
    } catch (error) {
      abortController.abort()
      await closeHandle(handle)
      log.error(
        {
          externalProvider: "opencode",
          workspaceRoot,
          error: describeError(error),
        },
        "OpenCode SDK managed server start failed"
      )
      if (error instanceof ExternalAdapterError) {
        throw error
      }
      throw new ExternalAdapterError(
        "ADAPTER_SERVER_START_FAILED",
        "Failed to start OpenCode managed server through the SDK",
        { workspaceRoot, cause: describeError(error) }
      )
    }
  }

  private async startCliManaged(workspaceRoot: string): Promise<OpenCodeWorkspaceConnection> {
    const port = await this.allocatePort()
    const server = await this.startCliServer(workspaceRoot, port)
    const client = this.createClient({
      baseUrl: server.url,
      directory: workspaceRoot,
    })

    try {
      await this.validateWorkspace(client, workspaceRoot)
      log.info(
        {
          externalProvider: "opencode",
          workspaceRoot,
          serverUrl: server.url,
        },
        "OpenCode CLI managed server validated"
      )
      return this.createConnection(workspaceRoot, client, server)
    } catch (error) {
      log.error(
        {
          externalProvider: "opencode",
          workspaceRoot,
          serverUrl: server.url,
          error: describeError(error),
        },
        "OpenCode CLI managed server validation failed"
      )
      await closeHandle(server)
      throw error
    }
  }

  private async startCliServer(workspaceRoot: string, port: number): Promise<OpenCodeServerHandle> {
    let proc: OpenCodeManagedProcess
    try {
      log.info(
        {
          externalProvider: "opencode",
          workspaceRoot,
          hostname: this.hostname,
          port,
          command: "opencode serve",
        },
        "OpenCode CLI server launching"
      )
      proc = this.launchProcess("opencode", [
        "serve",
        `--hostname=${this.hostname}`,
        `--port=${port}`,
      ], {
        cwd: workspaceRoot,
        env: { ...process.env },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch (error) {
      log.error(
        {
          externalProvider: "opencode",
          workspaceRoot,
          error: describeError(error),
        },
        "OpenCode CLI server launch failed"
      )
      throw new ExternalAdapterError(
        "ADAPTER_SERVER_START_FAILED",
        "Failed to launch OpenCode CLI server",
        { workspaceRoot, cause: describeError(error) }
      )
    }

    const url = await waitForCliServerUrl(proc, this.startupTimeoutMs, workspaceRoot)
    log.info(
      {
        externalProvider: "opencode",
        workspaceRoot,
        serverUrl: url,
        port,
      },
      "OpenCode CLI server listening"
    )
    let closing = false
    proc.once("exit", (code, signal) => {
      const payload = {
        externalProvider: "opencode",
        workspaceRoot,
        serverUrl: url,
        code,
        signal,
        intentional: closing,
      }
      if (closing) {
        log.info(payload, "OpenCode CLI server process exited")
      } else {
        log.warn(payload, "OpenCode CLI server process exited")
      }
    })
    proc.once("error", (error) => {
      log.error(
        {
          externalProvider: "opencode",
          workspaceRoot,
          serverUrl: url,
          error: describeError(error),
        },
        "OpenCode CLI server process error"
      )
    })
    return {
      url,
      close() {
        closing = true
        log.info(
          {
            externalProvider: "opencode",
            workspaceRoot,
            serverUrl: url,
          },
          "OpenCode CLI server stopping"
        )
        stopProcess(proc)
      },
    }
  }

  private async validateWorkspace(client: OpenCodeApiClient, workspaceRoot: string): Promise<void> {
    let project: Project
    let pathInfo: OpenCodePath

    try {
      log.info(
        {
          externalProvider: "opencode",
          workspaceRoot,
        },
        "OpenCode workspace validation starting"
      )
      const [projectResponse, pathResponse] = await Promise.all([
        client.project.current({
          directory: workspaceRoot,
        }),
        client.path.get({
          directory: workspaceRoot,
        }),
      ])
      project = unwrapOpenCodeResponse<Project>(
        projectResponse,
        "ADAPTER_SERVER_UNHEALTHY",
        "OpenCode project.current check failed"
      )
      pathInfo = unwrapOpenCodeResponse<OpenCodePath>(
        pathResponse,
        "ADAPTER_SERVER_UNHEALTHY",
        "OpenCode path.get check failed"
      )
    } catch (error) {
      log.error(
        {
          externalProvider: "opencode",
          workspaceRoot,
          error: describeError(error),
        },
        "OpenCode workspace validation request failed"
      )
      if (error instanceof ExternalAdapterError) {
        throw error
      }
      throw new ExternalAdapterError(
        "ADAPTER_SERVER_UNHEALTHY",
        "OpenCode server did not pass workspace health checks",
        { workspaceRoot, cause: describeError(error) }
      )
    }

    const mismatches: Array<{ field: string; actual?: string; expected: string }> = []
    if (!(await samePath(project.worktree, workspaceRoot))) {
      mismatches.push({
        field: "project.worktree",
        actual: project.worktree,
        expected: workspaceRoot,
      })
    }
    if (!(await samePath(pathInfo.directory, workspaceRoot))) {
      mismatches.push({
        field: "path.directory",
        actual: pathInfo.directory,
        expected: workspaceRoot,
      })
    }
    if (!(await samePath(pathInfo.worktree, workspaceRoot))) {
      mismatches.push({
        field: "path.worktree",
        actual: pathInfo.worktree,
        expected: workspaceRoot,
      })
    }

    if (mismatches.length > 0) {
      log.error(
        {
          externalProvider: "opencode",
          workspaceRoot,
          mismatches,
        },
        "OpenCode workspace validation failed"
      )
      throw new ExternalAdapterError(
        "ADAPTER_WORKSPACE_MISMATCH",
        "OpenCode server workspace does not match the AgentHub workspace",
        { workspaceRoot, mismatches }
      )
    }
    log.info(
      {
        externalProvider: "opencode",
        workspaceRoot,
        projectId: project.id,
        projectWorktree: project.worktree,
        pathDirectory: pathInfo.directory,
        pathWorktree: pathInfo.worktree,
      },
      "OpenCode workspace validation completed"
    )
  }

  private createConnection(
    workspaceRoot: string,
    client: OpenCodeApiClient,
    server: OpenCodeServerHandle,
    beforeClose?: () => void
  ): OpenCodeWorkspaceConnection {
    let closed = false
    const connection: OpenCodeWorkspaceConnection = {
      mode: "managed-by-runtime",
      client,
      directory: workspaceRoot,
      server,
      close: async () => {
        if (closed) return
        closed = true
        log.info(
          {
            externalProvider: "opencode",
            workspaceRoot,
            serverUrl: server.url,
          },
          "OpenCode workspace connection closing"
        )
        this.connections.delete(workspaceRoot)
        beforeClose?.()
        await closeHandle(server)
      },
    }
    return connection
  }

  private registerProcessCleanup(): void {
    if (this.cleanupRegistered) return
    this.cleanupRegistered = true
    const close = () => {
      for (const connection of this.connections.values()) {
        void connection.close()
      }
      this.connections.clear()
    }
    process.once("exit", close)
  }
}

export function detectOpenCodeSdkWorkspaceOption(): OpenCodeSdkWorkspaceOption | null {
  // @opencode-ai/sdk 1.15.13 ServerOptions exposes hostname, port, signal,
  // timeout, and config only. Keep this explicit until the SDK surfaces a
  // process-local workspace option that does not require process.chdir().
  return null
}

export function unwrapOpenCodeResponse<T>(
  response: unknown,
  code: ExternalAdapterErrorCode,
  message: string
): T {
  const record = isRecord(response) ? response : {}
  if ("error" in record && record.error !== undefined) {
    throw new ExternalAdapterError(code, message, { provider: "opencode", error: record.error })
  }
  if (!("data" in record) || record.data === undefined) {
    throw new ExternalAdapterError(code, message, { provider: "opencode" })
  }
  return record.data as T
}

async function waitForCliServerUrl(
  proc: OpenCodeManagedProcess,
  timeoutMs: number,
  workspaceRoot: string
): Promise<string> {
  return new Promise<string>((resolveUrl, rejectUrl) => {
    let settled = false
    let output = ""

    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      cleanup()
      callback()
    }

    const appendOutput = (chunk: Buffer | string): void => {
      output += chunk.toString()
      if (output.length > MAX_STARTUP_OUTPUT_CHARS) {
        output = output.slice(-MAX_STARTUP_OUTPUT_CHARS)
      }
    }

    const onStdout = (chunk: Buffer | string): void => {
      appendOutput(chunk)
      const url = parseOpenCodeServerUrl(output)
      if (url) {
        finish(() => resolveUrl(url))
      }
    }

    const onStderr = (chunk: Buffer | string): void => {
      appendOutput(chunk)
    }

    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(() => rejectUrl(new ExternalAdapterError(
        "ADAPTER_SERVER_START_FAILED",
        "OpenCode CLI server exited before it became healthy",
        { workspaceRoot, code, signal, output: output.trim() || undefined }
      )))
      log.error(
        {
          externalProvider: "opencode",
          workspaceRoot,
          code,
          signal,
          output: output.trim() || undefined,
        },
        "OpenCode CLI server exited before startup completed"
      )
    }

    const onError = (error: Error): void => {
      finish(() => rejectUrl(new ExternalAdapterError(
        "ADAPTER_SERVER_START_FAILED",
        "OpenCode CLI server failed to start",
        { workspaceRoot, cause: describeError(error), output: output.trim() || undefined }
      )))
      log.error(
        {
          externalProvider: "opencode",
          workspaceRoot,
          error: describeError(error),
          output: output.trim() || undefined,
        },
        "OpenCode CLI server startup errored"
      )
    }

    const onTimeout = (): void => {
      finish(() => {
        stopProcess(proc)
        log.error(
          {
            externalProvider: "opencode",
            workspaceRoot,
            timeoutMs,
            output: output.trim() || undefined,
          },
          "OpenCode CLI server startup timed out"
        )
        rejectUrl(new ExternalAdapterError(
          "ADAPTER_SERVER_UNHEALTHY",
          `Timed out waiting for OpenCode server to start after ${timeoutMs}ms`,
          { workspaceRoot, output: output.trim() || undefined }
        ))
      })
    }

    const cleanup = (): void => {
      proc.stdout.off("data", onStdout)
      proc.stderr.off("data", onStderr)
      proc.off("exit", onExit)
      proc.off("error", onError)
    }

    const timeout = setTimeout(onTimeout, timeoutMs)
    proc.stdout.on("data", onStdout)
    proc.stderr.on("data", onStderr)
    proc.once("exit", onExit)
    proc.once("error", onError)
  })
}

function parseOpenCodeServerUrl(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith("opencode server listening")) continue
    const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
    if (match?.[1]) {
      return match[1]
    }
  }
  return null
}

async function allocateTcpPort(): Promise<number> {
  return new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer()
    server.unref()
    server.once("error", rejectPort)
    server.listen(0, DEFAULT_HOSTNAME, () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === "object") {
          resolvePort(address.port)
        } else {
          rejectPort(new Error("Failed to allocate a TCP port"))
        }
      })
    })
  })
}

async function canonicalizePath(input: string): Promise<string> {
  const resolved = normalize(resolve(input))
  try {
    return normalize(await realpath(resolved))
  } catch {
    return resolved
  }
}

async function samePath(left: string | undefined, right: string): Promise<boolean> {
  if (!left) return false
  const [leftPath, rightPath] = await Promise.all([
    canonicalizePath(left),
    canonicalizePath(right),
  ])
  return normalizeForCompare(leftPath) === normalizeForCompare(rightPath)
}

function normalizeForCompare(input: string): string {
  const normalized = normalize(input)
  return platform() === "win32" ? normalized.toLowerCase() : normalized
}

function defaultCreateClient(config: { baseUrl: string; directory: string }): OpenCodeApiClient {
  return createOpencodeClient({
    baseUrl: config.baseUrl,
    directory: config.directory,
  })
}

async function defaultCreateSdkManaged(options: Record<string, unknown>): Promise<{
  client: OpenCodeApiClient
  server: OpenCodeServerHandle
}> {
  return createOpencode(options as Parameters<typeof createOpencode>[0])
}

function defaultLaunchProcess(
  command: string,
  args: string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    windowsHide: boolean
    stdio: ["ignore", "pipe", "pipe"]
  }
): OpenCodeManagedProcess {
  return spawn(command, args, options)
}

async function closeHandle(handle: OpenCodeServerHandle | undefined): Promise<void> {
  if (!handle) return
  await handle.close()
}

function stopProcess(proc: OpenCodeManagedProcess): void {
  if (proc.killed) return
  proc.kill()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function describeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    }
  }
  return error
}

function sanitizeStatusError(error: unknown): unknown {
  if (error instanceof ExternalAdapterError) {
    return {
      code: error.code,
      message: error.message,
    }
  }
  return describeError(error)
}
