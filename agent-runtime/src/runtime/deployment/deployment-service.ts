import { createRunEvent } from "../run-events"
import type { RunEvent } from "../types"
import type { ToolExecutionContext, ToolExecutionResult } from "../tools/types"
import { EmptyDeploymentServerResolver, type DeploymentServerResolver } from "./server-resolver"
import {
  SshDeploymentConnectionManager,
  type RunDeployCommandRequest,
  type UploadDeployArtifactRequest,
} from "./ssh-connection-manager"
import type {
  DeploymentRuntimeEventName,
  DeploymentService,
  DeploymentToolEventContext,
} from "./types"

const SECRET_PATTERNS: RegExp[] = [
  /(password|passwd|pwd|token|secret|api[_-]?key|private[_-]?key)=([^\s]+)/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
]

export function redactDeploymentText(value: string): string {
  return SECRET_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, (_match, key) => key ? `${key}=[redacted]` : "[redacted]"),
    value
  )
}

export function createDeploymentEvent(
  context: DeploymentToolEventContext,
  type: DeploymentRuntimeEventName,
  data: Record<string, unknown>
): RunEvent {
  const event = createRunEvent(context.runId, type, context.agentId, data)
  event.toolCallId = context.toolCallId
  event.toolName = context.toolName
  return event
}

function unavailable(toolName: string): ToolExecutionResult {
  return {
    status: "failed",
    summary: "Deployment service is not configured",
    error: {
      code: "DEPLOYMENT_SERVICE_UNAVAILABLE",
      message: `${toolName} cannot run because the deployment service is not configured`,
    },
  }
}

function toToolEventContext(
  context: ToolExecutionContext,
  toolName: string
): DeploymentToolEventContext {
  return {
    runId: context.runId,
    conversationId: context.input.conversationId,
    agentId: context.agent.id,
    toolCallId: context.toolCallId,
    toolName,
    emitEvent: context.emitEvent,
  }
}

type DefaultDeploymentServiceOptions = {
  resolver?: DeploymentServerResolver
  connectionManager?: SshDeploymentConnectionManager
}

export class DefaultDeploymentService implements DeploymentService {
  private resolver: DeploymentServerResolver
  private connectionManager: SshDeploymentConnectionManager

  constructor(options: DefaultDeploymentServiceOptions = {}) {
    this.resolver = options.resolver ?? new EmptyDeploymentServerResolver()
    this.connectionManager = options.connectionManager ?? new SshDeploymentConnectionManager()
  }

  async listServers(): Promise<ToolExecutionResult> {
    try {
      const servers = await this.resolver.listServers()
      return {
        status: "completed",
        summary: servers.length === 0
          ? "No deployment servers are configured"
          : `Found ${servers.length} deployment server${servers.length === 1 ? "" : "s"}`,
        data: {
          servers,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to list deployment servers"
      return {
        status: "failed",
        summary: message,
        error: {
          code: "DEPLOYMENT_SERVER_LIST_FAILED",
          message,
        },
      }
    }
  }

  async connectServer(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const data = input as { serverId: string; deploymentId?: string; reason?: string }
    const deploymentId = data.deploymentId ?? `deployment_${context.runId}`
    const eventContext = toToolEventContext(context, "connect_deploy_server")

    try {
      const material = await this.resolver.getServerMaterial(data.serverId)
      context.emitEvent(createDeploymentEvent(eventContext, "deployment.started", {
        deploymentId,
        conversationId: context.input.conversationId,
        status: "running",
        server: {
          id: material.id,
          displayName: material.displayName,
          hostLabel: material.hostLabel,
          port: material.port,
          user: material.user ?? material.username,
        },
        title: data.reason,
        strategy: "unknown",
      }))
      const connection = await this.connectionManager.connect({
        runId: context.runId,
        conversationId: context.input.conversationId,
        deploymentId,
        material,
        agentId: context.agent.id,
        toolCallId: context.toolCallId,
        toolName: "connect_deploy_server",
        emitEvent: context.emitEvent,
      })
      return {
        status: "completed",
        summary: `Connected to ${connection.server.displayName}`,
        data: {
          deploymentId,
          connectionId: connection.connectionId,
          server: connection.server,
          connectionStatus: "connected",
        },
      }
    } catch (error) {
      const message = redactDeploymentText(error instanceof Error ? error.message : "Deployment connection failed")
      context.emitEvent(createDeploymentEvent(eventContext, "deployment.connection.changed", {
        deploymentId,
        conversationId: context.input.conversationId,
        server: { id: data.serverId, displayName: data.serverId },
        connectionStatus: "failed",
        reason: message,
      }))
      return {
        status: "failed",
        summary: message,
        error: {
          code: "DEPLOYMENT_CONNECTION_FAILED",
          message,
        },
      }
    }
  }

  getCommandApprovalContext(input: unknown) {
    const data = input as { connectionId: string; cwd?: string }
    return this.connectionManager.getApprovalContext(data.connectionId, data.cwd)
  }

  async runCommand(input: unknown, context: DeploymentToolEventContext): Promise<ToolExecutionResult> {
    return this.connectionManager.runCommand(input as RunDeployCommandRequest, context)
  }

  async updateStatus(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const data = input as Record<string, unknown>
    const deploymentId = typeof data.deploymentId === "string" && data.deploymentId.length > 0
      ? data.deploymentId
      : `deployment_${context.runId}`
    const base = {
      deploymentId,
      conversationId: context.input.conversationId,
      connectionId: typeof data.connectionId === "string" ? data.connectionId : undefined,
    }

    const eventContext = toToolEventContext(context, "update_deployment_status")
    context.emitEvent(createDeploymentEvent(eventContext, "deployment.progress.updated", {
      ...base,
      percent: data.percent,
      currentStep: data.currentStep,
      totalSteps: data.totalSteps,
      stepId: data.stepId,
      stepTitle: data.stepTitle,
      message: data.message,
    }))

    if (typeof data.releaseNote === "string" && data.releaseNote.trim().length > 0) {
      context.emitEvent(createDeploymentEvent(eventContext, "deployment.release_note.updated", {
        ...base,
        releaseNote: redactDeploymentText(data.releaseNote),
      }))
    }

    if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
      const type = data.status === "completed"
        ? "deployment.completed"
        : data.status === "failed"
          ? "deployment.failed"
          : "deployment.cancelled"
      context.emitEvent(createDeploymentEvent(eventContext, type, {
        ...base,
        status: data.status,
        deploymentUrl: typeof data.deploymentUrl === "string" ? data.deploymentUrl : undefined,
        summary: typeof data.message === "string" ? data.message : undefined,
      }))
    }

    return {
      status: "completed",
      summary: "Deployment status updated",
      data: {
        deploymentId,
        status: data.status ?? "running",
      },
    }
  }

  async closeConnection(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const data = input as { connectionId: string; reason?: string }
    return this.connectionManager.closeConnection(
      data.connectionId,
      toToolEventContext(context, "close_deploy_connection"),
      data.reason
    )
  }

  closeConnectionById(
    connectionId: string,
    emitEvent: (event: RunEvent) => void,
    reason?: string
  ): ToolExecutionResult {
    return this.connectionManager.closeConnectionById(connectionId, emitEvent, reason)
  }

  async uploadArtifact(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const data = input as {
      connectionId: string
      localPath: string
      remotePath: string
      mode: "file" | "directory"
      reason: string
    }
    if (!context.workspaceService) {
      return {
        status: "failed",
        summary: "Deployment artifact upload requires a bound workspace",
        error: {
          code: "WORKSPACE_NOT_BOUND",
          message: "Deployment artifact upload requires a bound workspace",
        },
      }
    }

    const access = await context.workspaceService.resolveAccess({
      runId: context.runId,
      agentId: context.agent.id,
      path: data.localPath,
      accessMode: "read",
      reason: data.reason,
      toolName: "upload_deploy_artifact",
      targetKind: data.mode === "directory" ? "directory" : "file",
    })
    if (access.kind !== "allowed") {
      return {
        status: "failed",
        summary: "Deployment artifact path is not available",
        error: {
          code: access.kind === "approval_required"
            ? "DEPLOYMENT_UPLOAD_REQUIRES_APPROVAL"
            : access.kind === "not_found"
              ? "DEPLOYMENT_UPLOAD_PATH_NOT_FOUND"
              : access.code,
          message: access.kind === "approval_required"
            ? "Deployment artifact upload cannot read this path without additional workspace approval"
            : access.message,
        },
      }
    }

    const request: UploadDeployArtifactRequest = {
      connectionId: data.connectionId,
      localPath: data.localPath,
      remotePath: data.remotePath,
      mode: data.mode,
      reason: data.reason,
      localAbsolutePath: access.absolutePath,
      localLogicalPath: access.logicalPath,
    }
    return this.connectionManager.uploadArtifact(
      request,
      toToolEventContext(context, "upload_deploy_artifact")
    )
  }

  async checkUrl(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const data = input as {
      deploymentId?: string
      connectionId?: string
      url: string
      timeoutMs?: number
      expectedStatus?: number
      openPreview?: boolean
    }
    const deploymentId = data.deploymentId ?? `deployment_${context.runId}`
    const base = {
      deploymentId,
      conversationId: context.input.conversationId,
      connectionId: data.connectionId,
    }
    const eventContext = toToolEventContext(context, "check_deployment_url")
    const startedAt = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), data.timeoutMs ?? 15_000)
    try {
      const response = await fetch(data.url, {
        method: "GET",
        signal: controller.signal,
      })
      const durationMs = Date.now() - startedAt
      const ok = data.expectedStatus
        ? response.status === data.expectedStatus
        : response.ok
      const summary = ok
        ? `Deployment URL responded with ${response.status}`
        : `Deployment URL health check returned ${response.status}`
      context.emitEvent(createDeploymentEvent(eventContext, "deployment.progress.updated", {
        ...base,
        message: summary,
        health: {
          url: data.url,
          ok,
          status: response.status,
          durationMs,
        },
      }))
      if (data.openPreview) {
        context.emitEvent(createDeploymentEvent(eventContext, "deployment.preview.requested", {
          ...base,
          url: data.url,
          openMode: "preview-tab",
        }))
      }
      return {
        status: "completed",
        summary,
        data: {
          url: data.url,
          ok,
          status: response.status,
          durationMs,
        },
      }
    } catch (error) {
      const durationMs = Date.now() - startedAt
      const message = redactDeploymentText(error instanceof Error ? error.message : "Deployment URL check failed")
      context.emitEvent(createDeploymentEvent(eventContext, "deployment.progress.updated", {
        ...base,
        message,
        health: {
          url: data.url,
          ok: false,
          durationMs,
          error: message,
        },
      }))
      return {
        status: "failed",
        summary: message,
        data: {
          url: data.url,
          ok: false,
          durationMs,
        },
        error: {
          code: "DEPLOYMENT_URL_CHECK_FAILED",
          message,
        },
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  closeRunConnections(runId: string, emitEvent?: (event: RunEvent) => void): void {
    this.connectionManager.closeRunConnections(runId, emitEvent)
  }
}
