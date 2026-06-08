import type {
  NormalizedQuestionAnswer,
  QuestionItem,
} from "../question"
import type { ExternalAdapterPrompt, ExternalSessionLink, ExternalSessionScope } from "./types"

export type ClaudeCodeSessionRequest = {
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

export type ClaudeCodePermissionMode = "default" | "acceptEdits" | "plan" | "dontAsk" | "auto"

export type ClaudeCodePromptRequest = {
  session: ExternalSessionLink
  prompt: ExternalAdapterPrompt
  cwd: string
  signal: AbortSignal
  model?: string
  permissionMode?: ClaudeCodePermissionMode
  permissionHandler?: (request: ClaudeCodePermissionRequest) => Promise<ClaudeCodePermissionDecision>
  questionHandler?: (request: ClaudeCodeQuestionRequest) => Promise<NormalizedQuestionAnswer[]>
}

export type ClaudeCodeExternalModel = {
  provider: "claude-code"
  providerId: "anthropic"
  modelId: string
  providerName?: string
  modelName?: string
}

export type ClaudeCodePermissionRequest = {
  providerPermissionId: string
  permissionKind: string
  input?: Record<string, unknown>
  providerToolCallId?: string
  providerMetadata?: Record<string, unknown>
  reason?: string
}

export type ClaudeCodePermissionDecision = {
  approved: boolean
  reason?: string
}

export type ClaudeCodeQuestionRequest = {
  providerQuestionId: string
  questions: QuestionItem[]
  providerToolCallId?: string
  providerMetadata?: Record<string, unknown>
}

export type ClaudeCodePromptEvent =
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
      externalModel?: ClaudeCodeExternalModel
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

export type ClaudeCodeClient = {
  ensureSession(request: ClaudeCodeSessionRequest): Promise<ExternalSessionLink>
  streamPrompt(request: ClaudeCodePromptRequest): AsyncIterable<ClaudeCodePromptEvent>
}

export class FakeClaudeCodeClient implements ClaudeCodeClient {
  async ensureSession(request: ClaudeCodeSessionRequest): Promise<ExternalSessionLink> {
    if (request.providerSessionId) {
      return {
        provider: "claude-code",
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
      provider: "claude-code",
      agentId: request.agentId,
      scope: request.scope,
      providerSessionId: `fake_claude_code_${request.workspaceId}_${request.scope}_${suffix}`,
      conversationId: request.conversationId,
      workspaceId: request.workspaceId,
      taskId: request.taskId,
      runId: request.runId,
    }
  }

  async *streamPrompt(request: ClaudeCodePromptRequest): AsyncIterable<ClaudeCodePromptEvent> {
    if (request.signal.aborted) {
      return
    }

    const text = request.prompt.task
      ? `Claude Code fake adapter completed delegated task "${request.prompt.task.title}".`
      : `Claude Code fake adapter received: ${request.prompt.content}`

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
        provider: "claude-code",
        providerId: "anthropic",
        modelId: "fake-claude-model",
      },
    }
  }
}
