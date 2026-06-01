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
  signal: AbortSignal
}

export type OpenCodePromptEvent =
  | {
      type: "message.delta"
      delta: string
    }
  | {
      type: "message.completed"
      content: string
    }

export type OpenCodeClient = {
  ensureSession(request: OpenCodeSessionRequest): Promise<ExternalSessionLink>
  streamPrompt(request: OpenCodePromptRequest): AsyncIterable<OpenCodePromptEvent>
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
    }
  }
}
