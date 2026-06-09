import { createDeploymentEvent, redactDeploymentText } from "./deployment-service"
import type {
  DeploymentServerMaterial,
} from "./server-resolver"
import type {
  DeploymentCommandApprovalContext,
  DeploymentServerSummary,
  DeploymentToolEventContext,
} from "./types"
import type { RunEvent } from "../types"
import type { ToolExecutionResult } from "../tools/types"

const DEFAULT_READY_TIMEOUT_MS = 15_000
const DEFAULT_COMMAND_TIMEOUT_MS = 300_000
const DEFAULT_MAX_OUTPUT_BYTES = 131_072

type SshClient = {
  connect(options: Record<string, unknown>): void
  exec(command: string, callback: (error: Error | undefined, stream: SshExecStream) => void): void
  sftp(callback: (error: Error | undefined, sftp: SftpClient) => void): void
  end(): void
  destroy(): void
  on(event: string, listener: (...args: any[]) => void): SshClient
  once(event: string, listener: (...args: any[]) => void): SshClient
}

type SftpClient = {
  fastPut(localPath: string, remotePath: string, callback: (error?: Error) => void): void
  mkdir(path: string, attributes: Record<string, unknown> | undefined, callback: (error?: Error) => void): void
  end(): void
}

type SshExecStream = {
  stderr?: {
    on(event: "data", listener: (chunk: Buffer | string) => void): void
  }
  on(event: "data", listener: (chunk: Buffer | string) => void): SshExecStream
  on(event: "close", listener: (code: number | null, signal: string | null) => void): SshExecStream
  on(event: "error", listener: (error: Error) => void): SshExecStream
  signal?(name: string): void
}

export type DeploymentConnectionRecord = {
  connectionId: string
  runId: string
  conversationId: string
  deploymentId: string
  server: DeploymentServerSummary & { user: string }
  client: SshClient
  status: "connected" | "disconnected"
  createdAt: string
  lastUsedAt: string
}

export type RunDeployCommandRequest = {
  connectionId: string
  command: string
  cwd?: string
  reason: string
  timeoutMs?: number
  maxOutputBytes?: number
}

export type UploadDeployArtifactRequest = {
  connectionId: string
  localPath: string
  remotePath: string
  mode: "file" | "directory"
  reason: string
  localAbsolutePath: string
  localLogicalPath: string
}

function toServerSummary(material: DeploymentServerMaterial): DeploymentServerSummary & { user: string } {
  return {
    id: material.id,
    displayName: material.displayName,
    hostLabel: material.hostLabel,
    port: material.port,
    user: material.user ?? material.username,
  }
}

function createConnectionId(serverId: string): string {
  return `deploy_conn_${serverId}_${crypto.randomUUID()}`
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function createRemoteCommand(command: string, cwd?: string): string {
  const trimmedCwd = cwd?.trim()
  return trimmedCwd ? `cd ${quotePosix(trimmedCwd)} && ${command}` : command
}

function joinRemotePath(basePath: string, childName: string): string {
  return `${basePath.replace(/\/+$/, "")}/${childName.replace(/^\/+/, "")}`
}

function appendBounded(
  current: string,
  chunk: string,
  maxBytes: number
): { text: string; truncated: boolean } {
  const combined = current + chunk
  const bytes = Buffer.byteLength(combined, "utf-8")
  if (bytes <= maxBytes) {
    return { text: combined, truncated: false }
  }

  const buffer = Buffer.from(combined, "utf-8").subarray(0, maxBytes)
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(buffer),
    truncated: true,
  }
}

export class SshDeploymentConnectionManager {
  private connections = new Map<string, DeploymentConnectionRecord>()

  async connect(options: {
    runId: string
    conversationId: string
    deploymentId: string
    material: DeploymentServerMaterial
    emitEvent: DeploymentToolEventContext["emitEvent"]
    agentId: string
    toolCallId: string
    toolName: string
  }): Promise<DeploymentConnectionRecord> {
    const ssh2 = await import("ssh2")
    const client = new ssh2.Client() as SshClient
    const connectionId = createConnectionId(options.material.id)
    const server = toServerSummary(options.material)
    const eventContext: DeploymentToolEventContext = {
      runId: options.runId,
      conversationId: options.conversationId,
      agentId: options.agentId,
      toolCallId: options.toolCallId,
      toolName: options.toolName,
      emitEvent: options.emitEvent,
    }

    options.emitEvent(createDeploymentEvent(eventContext, "deployment.connection.changed", {
      deploymentId: options.deploymentId,
      conversationId: options.conversationId,
      connectionId,
      server,
      connectionStatus: "connecting",
    }))

    let record: DeploymentConnectionRecord | undefined
    const emitConnectionChanged = (
      connectionStatus: "connected" | "disconnected" | "failed",
      reason?: string
    ): void => {
      options.emitEvent(createDeploymentEvent(eventContext, "deployment.connection.changed", {
        deploymentId: options.deploymentId,
        conversationId: options.conversationId,
        connectionId,
        server,
        connectionStatus,
        ...(reason ? { reason: redactDeploymentText(reason) } : {}),
      }))
    }
    const markDisconnectedAfterConnect = (
      connectionStatus: "disconnected" | "failed",
      reason: string
    ): void => {
      if (!record || record.status !== "connected") {
        return
      }
      record.status = "disconnected"
      this.connections.delete(record.connectionId)
      emitConnectionChanged(connectionStatus, reason)
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) {
          return
        }
        settled = true
        client.destroy()
        emitConnectionChanged("failed", "SSH connection timed out")
        reject(new Error("SSH connection timed out"))
      }, options.material.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS)

      client.once("ready", () => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        resolve()
      })
      client.on("error", (error: Error) => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          client.destroy()
          emitConnectionChanged("failed", error.message)
          reject(error)
          return
        }
        markDisconnectedAfterConnect("failed", error.message)
      })
      client.on("close", () => {
        markDisconnectedAfterConnect("disconnected", "ssh_close")
      })
      client.on("end", () => {
        markDisconnectedAfterConnect("disconnected", "ssh_end")
      })

      client.connect({
        host: options.material.host,
        port: options.material.port,
        username: options.material.username,
        privateKey: options.material.privateKey,
        password: options.material.password,
        passphrase: options.material.passphrase,
        agent: options.material.agent,
        readyTimeout: options.material.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
        keepaliveInterval: 15_000,
      })
    })

    const now = new Date().toISOString()
    record = {
      connectionId,
      runId: options.runId,
      conversationId: options.conversationId,
      deploymentId: options.deploymentId,
      server,
      client,
      status: "connected",
      createdAt: now,
      lastUsedAt: now,
    }
    this.connections.set(connectionId, record)

    emitConnectionChanged("connected")

    return record
  }

  getApprovalContext(connectionId: string, cwd?: string): DeploymentCommandApprovalContext {
    const connection = this.requireConnection(connectionId)
    return {
      server: connection.server,
      cwd,
    }
  }

  async runCommand(
    input: RunDeployCommandRequest,
    context: DeploymentToolEventContext
  ): Promise<ToolExecutionResult> {
    const connection = this.requireConnection(input.connectionId)
    connection.lastUsedAt = new Date().toISOString()
    const commandId = `deploy_cmd_${crypto.randomUUID()}`
    const startedAt = Date.now()
    const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
    const command = createRemoteCommand(input.command, input.cwd)

    context.emitEvent(createDeploymentEvent(context, "deployment.command.started", {
      deploymentId: connection.deploymentId,
      conversationId: connection.conversationId,
      connectionId: connection.connectionId,
      server: connection.server,
      commandId,
      command: input.command,
      cwd: input.cwd,
      reason: input.reason,
      startedAt: new Date(startedAt).toISOString(),
    }))

    let stdout = ""
    let stderr = ""
    let truncated = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    return await new Promise<ToolExecutionResult>((resolve) => {
      let settled = false
      const settle = (result: ToolExecutionResult): void => {
        if (settled) {
          return
        }
        settled = true
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        resolve(result)
      }

      connection.client.exec(command, (error, stream) => {
        if (error || !stream) {
          const message = error?.message ?? "Unable to start remote command"
          context.emitEvent(createDeploymentEvent(context, "deployment.command.failed", {
            deploymentId: connection.deploymentId,
            conversationId: connection.conversationId,
            connectionId: connection.connectionId,
            server: connection.server,
            commandId,
            error: { code: "DEPLOYMENT_COMMAND_START_FAILED", message: redactDeploymentText(message) },
          }))
          settle({
            status: "failed",
            summary: message,
            error: {
              code: "DEPLOYMENT_COMMAND_START_FAILED",
              message,
            },
          })
          return
        }

        timeoutId = setTimeout(() => {
          stream.signal?.("TERM")
          const durationMs = Date.now() - startedAt
          context.emitEvent(createDeploymentEvent(context, "deployment.command.failed", {
            deploymentId: connection.deploymentId,
            conversationId: connection.conversationId,
            connectionId: connection.connectionId,
            server: connection.server,
            commandId,
            durationMs,
            error: { code: "DEPLOYMENT_COMMAND_TIMEOUT", message: "Remote command timed out" },
          }))
          settle({
            status: "failed",
            summary: "远程命令超时",
            data: {
              commandId,
              connectionId: connection.connectionId,
              stdout,
              stderr,
              truncated,
              durationMs,
            },
            error: {
              code: "DEPLOYMENT_COMMAND_TIMEOUT",
              message: "Remote command timed out",
            },
          })
        }, input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS)

        stream.on("data", (chunk) => {
          const text = redactDeploymentText(String(chunk))
          const bounded = appendBounded(stdout, text, maxOutputBytes)
          stdout = bounded.text
          truncated = truncated || bounded.truncated
          context.emitEvent(createDeploymentEvent(context, "deployment.log.appended", {
            deploymentId: connection.deploymentId,
            conversationId: connection.conversationId,
            connectionId: connection.connectionId,
            commandId,
            stream: "stdout",
            text,
            truncated,
          }))
        })

        stream.stderr?.on("data", (chunk) => {
          const text = redactDeploymentText(String(chunk))
          const bounded = appendBounded(stderr, text, maxOutputBytes)
          stderr = bounded.text
          truncated = truncated || bounded.truncated
          context.emitEvent(createDeploymentEvent(context, "deployment.log.appended", {
            deploymentId: connection.deploymentId,
            conversationId: connection.conversationId,
            connectionId: connection.connectionId,
            commandId,
            stream: "stderr",
            text,
            truncated,
          }))
        })

        stream.on("error", (streamError) => {
          const durationMs = Date.now() - startedAt
          const message = redactDeploymentText(streamError.message)
          context.emitEvent(createDeploymentEvent(context, "deployment.command.failed", {
            deploymentId: connection.deploymentId,
            conversationId: connection.conversationId,
            connectionId: connection.connectionId,
            server: connection.server,
            commandId,
            durationMs,
            error: { code: "DEPLOYMENT_COMMAND_STREAM_FAILED", message },
          }))
          settle({
            status: "failed",
            summary: streamError.message,
            error: {
              code: "DEPLOYMENT_COMMAND_STREAM_FAILED",
              message: streamError.message,
            },
          })
        })

        stream.on("close", (exitCode, signal) => {
          const durationMs = Date.now() - startedAt
          if (exitCode === 0) {
            context.emitEvent(createDeploymentEvent(context, "deployment.command.completed", {
              deploymentId: connection.deploymentId,
              conversationId: connection.conversationId,
              connectionId: connection.connectionId,
              server: connection.server,
              commandId,
              exitCode,
              durationMs,
            }))
          } else {
            context.emitEvent(createDeploymentEvent(context, "deployment.command.failed", {
              deploymentId: connection.deploymentId,
              conversationId: connection.conversationId,
              connectionId: connection.connectionId,
              server: connection.server,
              commandId,
              exitCode: exitCode ?? undefined,
              signal: signal ?? undefined,
              durationMs,
              error: {
                code: "DEPLOYMENT_COMMAND_NON_ZERO_EXIT",
                message: `Remote command exited with code ${exitCode ?? "unknown"}`,
              },
            }))
          }

          settle({
            status: "completed",
            summary: `远程命令退出，代码 ${exitCode ?? "未知"}`,
            data: {
              commandId,
              connectionId: connection.connectionId,
              exitCode,
              signal,
              stdout,
              stderr,
              truncated,
              durationMs,
            },
          })
        })
      })
    })
  }

  closeConnection(
    connectionId: string,
    context: DeploymentToolEventContext,
    reason = "closed"
  ): ToolExecutionResult {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      return {
        status: "failed",
        summary: "部署连接未找到",
        error: {
          code: "DEPLOYMENT_CONNECTION_NOT_FOUND",
          message: `Deployment connection ${connectionId} was not found`,
        },
      }
    }

    connection.status = "disconnected"
    connection.client.end()
    this.connections.delete(connectionId)
    context.emitEvent(createDeploymentEvent(context, "deployment.connection.changed", {
      deploymentId: connection.deploymentId,
      conversationId: connection.conversationId,
      connectionId,
      server: connection.server,
      connectionStatus: "disconnected",
      reason,
    }))

    return {
      status: "completed",
      summary: "部署连接已关闭",
      data: {
        connectionId,
        connectionStatus: "disconnected",
      },
    }
  }

  async uploadArtifact(
    input: UploadDeployArtifactRequest,
    context: DeploymentToolEventContext
  ): Promise<ToolExecutionResult> {
    const connection = this.requireConnection(input.connectionId)
    connection.lastUsedAt = new Date().toISOString()

    try {
      const sftp = await this.openSftp(connection)
      const uploaded = input.mode === "directory"
        ? await this.uploadDirectory(sftp, input.localAbsolutePath, input.remotePath)
        : await this.uploadFile(sftp, input.localAbsolutePath, input.remotePath)
      sftp.end()

      context.emitEvent(createDeploymentEvent(context, "deployment.log.appended", {
        deploymentId: connection.deploymentId,
        conversationId: connection.conversationId,
        connectionId: connection.connectionId,
        stream: "system",
        text: `Uploaded ${uploaded.fileCount} deployment artifact file${uploaded.fileCount === 1 ? "" : "s"} from ${input.localLogicalPath}.\n`,
      }))

      return {
        status: "completed",
        summary: `已上传 ${uploaded.fileCount} 个部署构件文件`,
        data: {
          connectionId: connection.connectionId,
          localPath: input.localLogicalPath,
          mode: input.mode,
          fileCount: uploaded.fileCount,
          bytes: uploaded.bytes,
        },
      }
    } catch (error) {
      const message = redactDeploymentText(error instanceof Error ? error.message : "Deployment artifact upload failed")
      context.emitEvent(createDeploymentEvent(context, "deployment.log.appended", {
        deploymentId: connection.deploymentId,
        conversationId: connection.conversationId,
        connectionId: connection.connectionId,
        stream: "system",
        text: `Artifact upload failed: ${message}\n`,
      }))
      return {
        status: "failed",
        summary: "部署构件上传失败",
        error: {
          code: "DEPLOYMENT_UPLOAD_FAILED",
          message,
        },
      }
    }
  }

  closeConnectionById(
    connectionId: string,
    emitEvent: (event: RunEvent) => void,
    reason = "manual_disconnect"
  ): ToolExecutionResult {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      return {
        status: "failed",
        summary: "部署连接未找到",
        error: {
          code: "DEPLOYMENT_CONNECTION_NOT_FOUND",
          message: `Deployment connection ${connectionId} was not found`,
        },
      }
    }

    connection.status = "disconnected"
    connection.client.end()
    this.connections.delete(connectionId)
    emitEvent(this.createConnectionChangedEvent(connection, reason))

    return {
      status: "completed",
      summary: "部署连接已关闭",
      data: {
        connectionId,
        connectionStatus: "disconnected",
      },
    }
  }

  closeRunConnections(runId: string, emitEvent?: (event: RunEvent) => void): void {
    for (const connection of Array.from(this.connections.values())) {
      if (connection.runId !== runId) {
        continue
      }
      connection.status = "disconnected"
      connection.client.end()
      this.connections.delete(connection.connectionId)
      if (emitEvent) {
        emitEvent(this.createConnectionChangedEvent(connection, "run_terminal"))
      }
    }
  }

  private openSftp(connection: DeploymentConnectionRecord): Promise<SftpClient> {
    return new Promise((resolve, reject) => {
      connection.client.sftp((error, sftp) => {
        if (error || !sftp) {
          reject(error ?? new Error("Unable to open SFTP session"))
          return
        }
        resolve(sftp)
      })
    })
  }

  private async uploadFile(
    sftp: SftpClient,
    localPath: string,
    remotePath: string
  ): Promise<{ fileCount: number; bytes: number }> {
    const { stat } = await import("node:fs/promises")
    const file = await stat(localPath)
    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    return { fileCount: 1, bytes: file.size }
  }

  private async uploadDirectory(
    sftp: SftpClient,
    localPath: string,
    remotePath: string
  ): Promise<{ fileCount: number; bytes: number }> {
    const { readdir, stat } = await import("node:fs/promises")
    await this.ensureRemoteDirectory(sftp, remotePath)
    let fileCount = 0
    let bytes = 0
    const entries = await readdir(localPath, { withFileTypes: true })
    for (const entry of entries) {
      const localChild = `${localPath.replace(/[\\/]+$/, "")}/${entry.name}`
      const remoteChild = joinRemotePath(remotePath, entry.name)
      if (entry.isDirectory()) {
        const childResult = await this.uploadDirectory(sftp, localChild, remoteChild)
        fileCount += childResult.fileCount
        bytes += childResult.bytes
      } else if (entry.isFile()) {
        const file = await stat(localChild)
        await this.uploadFile(sftp, localChild, remoteChild)
        fileCount += 1
        bytes += file.size
      }
    }
    return { fileCount, bytes }
  }

  private ensureRemoteDirectory(sftp: SftpClient, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, undefined, (error) => {
        if (!error || /failure|exists/i.test(error.message)) {
          resolve()
          return
        }
        reject(error)
      })
    })
  }

  private createConnectionChangedEvent(
    connection: DeploymentConnectionRecord,
    reason: string
  ): RunEvent {
    return {
      id: crypto.randomUUID(),
      runId: connection.runId,
      type: "deployment.connection.changed",
      timestamp: new Date().toISOString(),
      agentId: "deploy",
      data: {
        deploymentId: connection.deploymentId,
        conversationId: connection.conversationId,
        connectionId: connection.connectionId,
        server: connection.server,
        connectionStatus: "disconnected",
        reason,
      },
    }
  }

  private requireConnection(connectionId: string): DeploymentConnectionRecord {
    const connection = this.connections.get(connectionId)
    if (!connection || connection.status !== "connected") {
      throw new Error(`Deployment connection ${connectionId} is not connected`)
    }
    return connection
  }
}
