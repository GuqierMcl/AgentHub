import type { ExternalAdapterPrompt, ExternalSessionLink, ExternalSessionScope } from "./types"

export type CodexSessionRequest = {
  runId: string
  conversationId: string
  agentId: string
  scope: ExternalSessionScope
  workspaceId: string
  workspaceRootPath: string
  model?: string
  taskId?: string
  providerSessionId?: string
  handoffSummary?: string
}

export type CodexPromptRequest = {
  session: ExternalSessionLink
  prompt: ExternalAdapterPrompt
  cwd: string
  signal: AbortSignal
}

export type CodexExternalModel = {
  provider: "codex"
  providerId: "openai"
  modelId: string
  providerName?: string
  modelName?: string
}

export type CodexPromptEvent =
  | {
      type: "session.updated"
      providerSessionId: string
      modelId?: string
    }
  | {
      type: "message.delta"
      delta: string
    }
  | {
      type: "message.completed"
      content: string
      externalModel?: CodexExternalModel
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

export type CodexClient = {
  ensureSession(request: CodexSessionRequest): Promise<ExternalSessionLink>
  streamPrompt(request: CodexPromptRequest): AsyncIterable<CodexPromptEvent>
}

export class FakeCodexClient implements CodexClient {
  async ensureSession(request: CodexSessionRequest): Promise<ExternalSessionLink> {
    if (request.providerSessionId) {
      return {
        provider: "codex",
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
      provider: "codex",
      agentId: request.agentId,
      scope: request.scope,
      providerSessionId: `fake_codex_${request.workspaceId}_${request.scope}_${suffix}`,
      conversationId: request.conversationId,
      workspaceId: request.workspaceId,
      taskId: request.taskId,
      runId: request.runId,
    }
  }

  async *streamPrompt(request: CodexPromptRequest): AsyncIterable<CodexPromptEvent> {
    if (request.signal.aborted) {
      return
    }

    const text = request.prompt.task
      ? `Codex fake adapter completed delegated task "${request.prompt.task.title}".`
      : `Codex fake adapter received: ${request.prompt.content}`

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
        provider: "codex",
        providerId: "openai",
        modelId: "fake-codex-model",
      },
    }
  }
}
