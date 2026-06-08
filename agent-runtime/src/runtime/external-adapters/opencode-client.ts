import type { ExternalAdapterPrompt, ExternalSessionLink, ExternalSessionScope } from "./types"

export type OpenCodeSessionRequest = {
  runId: string
  conversationId: string
  agentId: string
  scope: ExternalSessionScope
  workspaceId: string
  workspaceRootPath: string
  taskId?: string
  providerSessionId?: string
  handoffSummary?: string
}

export type OpenCodePromptRequest = {
  session: ExternalSessionLink
  prompt: ExternalAdapterPrompt
  executionAgent?: OpenCodeExecutionAgent
  model?: OpenCodeModelOverride
  signal: AbortSignal
  permissionHandler?: (request: OpenCodePermissionRequest) => Promise<OpenCodePermissionDecision>
}

export type OpenCodeExecutionAgent = "build" | "plan"

export type OpenCodeModelOverride = {
  providerID: string
  modelID: string
}

export type OpenCodeModelCatalog = {
  provider: "opencode"
  models: Array<{
    providerID: string
    providerName?: string
    modelID: string
    modelName?: string
  }>
  warnings: string[]
}

export type OpenCodeExternalModel = {
  provider: "opencode"
  providerId: string
  modelId: string
  providerName?: string
  modelName?: string
}

export type OpenCodePermissionRequest = {
  providerPermissionId: string
  permissionKind: string
  patterns: string[]
  always?: string[]
  providerToolCallId?: string
  providerMessageId?: string
  providerMetadata?: Record<string, unknown>
  reason?: string
}

export type OpenCodePermissionDecision = {
  approved: boolean
  reason?: string
}

export type OpenCodePromptEvent =
  | {
      type: "message.delta"
      delta: string
    }
  | {
      type: "message.completed"
      content: string
      externalModel?: OpenCodeExternalModel
    }
  | {
      type: "reasoning.delta"
      reasoningId: string
      delta: string
    }
  | {
      type: "reasoning.completed"
      reasoningId: string
      content: string
    }
  | {
      type: "tool.started"
      providerEventId?: string
      providerToolCallId: string
      providerToolName: string
      input?: unknown
      providerExecuted?: boolean
      providerMetadata?: Record<string, unknown>
    }
  | {
      type: "tool.completed"
      providerEventId?: string
      providerToolCallId: string
      providerToolName: string
      input?: unknown
      output?: unknown
      providerExecuted?: boolean
      providerMetadata?: Record<string, unknown>
    }
  | {
      type: "tool.failed"
      providerEventId?: string
      providerToolCallId: string
      providerToolName: string
      input?: unknown
      error?: unknown
      providerExecuted?: boolean
      providerMetadata?: Record<string, unknown>
    }
  | ({
      type: "permission.requested"
    } & OpenCodePermissionRequest)

export type OpenCodeClient = {
  ensureSession(request: OpenCodeSessionRequest): Promise<ExternalSessionLink>
  streamPrompt(request: OpenCodePromptRequest): AsyncIterable<OpenCodePromptEvent>
  listModels(workspaceRootPath: string): Promise<OpenCodeModelCatalog>
}

export class FakeOpenCodeClient implements OpenCodeClient {
  async ensureSession(request: OpenCodeSessionRequest): Promise<ExternalSessionLink> {
    if (request.providerSessionId) {
      return {
        provider: "opencode",
        agentId: request.agentId,
        scope: request.scope,
        providerSessionId: request.providerSessionId,
        conversationId: request.conversationId,
        workspaceId: request.workspaceId,
        taskId: request.taskId,
        runId: request.runId,
        handoffSummary: request.handoffSummary,
      }
    }

    const suffix = request.scope === "delegated-task" && request.taskId
      ? request.taskId
      : request.conversationId

    return {
      provider: "opencode",
      agentId: request.agentId,
      scope: request.scope,
      providerSessionId: `fake_opencode_${request.workspaceId}_${request.scope}_${suffix}`,
      conversationId: request.conversationId,
      workspaceId: request.workspaceId,
      taskId: request.taskId,
      runId: request.runId,
    }
  }

  async *streamPrompt(request: OpenCodePromptRequest): AsyncIterable<OpenCodePromptEvent> {
    if (request.signal.aborted) {
      return
    }

    const text = request.prompt.task
      ? `OpenCode fake adapter completed delegated task "${request.prompt.task.title}".`
      : `OpenCode fake adapter received: ${request.prompt.content}`

    yield {
      type: "message.delta",
      delta: text,
    }

    if (request.signal.aborted) {
      return
    }

    yield {
      type: "message.completed",
      content: text,
      externalModel: {
        provider: "opencode",
        providerId: "fake-provider",
        modelId: "fake-model",
      },
    }
  }

  async listModels(_workspaceRootPath: string): Promise<OpenCodeModelCatalog> {
    return {
      provider: "opencode",
      models: [
        {
          providerID: "fake-provider",
          providerName: "Fake Provider",
          modelID: "fake-model",
          modelName: "Fake Model",
        },
      ],
      warnings: [],
    }
  }
}
