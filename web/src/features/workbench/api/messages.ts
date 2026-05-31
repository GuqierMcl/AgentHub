import type { RuntimeRunEvent, RuntimeRunStatus } from "./runtime-runs"

export type PersistedMessagePart = {
  id: string
  messageId: string
  conversationId: string
  runId: string | null
  runtimeEventId: string | null
  partKey: string
  partIndex: number
  entityType: string | null
  entityId: string | null
  type: string
  state: string
  text: string | null
  payloadJson: Record<string, unknown>
  firstEventSequence: number | null
  lastEventSequence: number | null
  createdAt: string
  updatedAt: string
}

export type PersistedMessage = {
  id: string
  conversationId: string
  runId: string | null
  runtimeMessageId: string | null
  runtimeRunId: string | null
  messageIndex: number | null
  surface: string
  role: "user" | "assistant" | "system"
  senderType: string
  senderId: string | null
  agentId: string | null
  taskId: string | null
  groupId: string | null
  status: "created" | "streaming" | "completed" | "failed" | "cancelled"
  finishReason: string | null
  firstEventSequence: number | null
  lastEventSequence: number | null
  metadataJson: Record<string, unknown>
  uiMessageJson: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  parts: PersistedMessagePart[]
}

export type ActiveRunSnapshot = {
  id: string
  runtimeId: string | null
  status: RuntimeRunStatus
  lastEventSequence: number
  plan: Record<string, unknown> | null
}

export type RunPlanSnapshot = {
  runId: string
  status: RuntimeRunStatus
  plan: Record<string, unknown>
  updatedAt: string
  completedAt: string | null
}

export type ConversationRunItemsSnapshot = {
  toolCalls: Record<string, unknown>[]
  reasoningBlocks: Record<string, unknown>[]
  taskGroups: Record<string, unknown>[]
  tasks: Record<string, unknown>[]
  plans: Record<string, unknown>[]
  planTasks: Record<string, unknown>[]
  permissionRequests: Record<string, unknown>[]
}

export type HubRunEventEnvelope = {
  sequence: number
  event: RuntimeRunEvent
}

export type ConversationTimelineRunSnapshot = {
  run: {
    id: string
    runtimeId: string | null
    status: RuntimeRunStatus
    triggerMessageId: string
    createdAt: string
    lastEventSequence: number
  }
  triggerMessage: PersistedMessage | null
  events: HubRunEventEnvelope[]
}

export type ConversationMessagesResponse = {
  messages: PersistedMessage[]
  activeRun: ActiveRunSnapshot | null
  latestPlan: RunPlanSnapshot | null
  runItems: ConversationRunItemsSnapshot
  timelineRuns: ConversationTimelineRunSnapshot[]
}

export type PermissionDecisionBody = {
  approved: boolean
  reason?: string
}

export type QuestionAnswerBody = {
  answers: Array<{
    questionId: string
    optionId?: string
    answer?: string
    custom?: boolean
  }>
}

export type SendConversationMessageOptions = {
  addressedAgentIds?: string[]
}

type ErrorBody = {
  error?: {
    code?: string
    message?: string
    details?: unknown
  }
}

export class ConversationMessageRequestError extends Error {
  code?: string
  details?: unknown

  constructor(message: string, code?: string, details?: unknown) {
    super(message)
    this.name = "ConversationMessageRequestError"
    this.code = code
    this.details = details
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as ErrorBody
    const message = body.error?.message ?? `请求失败 (${res.status})`
    throw new ConversationMessageRequestError(
      message,
      body.error?.code,
      body.error?.details
    )
  }

  return res.json()
}

export const conversationMessagesApi = {
  list(conversationId: string): Promise<ConversationMessagesResponse> {
    return request(`/api/conversations/${encodeURIComponent(conversationId)}/messages`)
  },

  send(
    conversationId: string,
    content: string,
    options?: SendConversationMessageOptions
  ): Promise<ConversationMessagesResponse> {
    const addressedAgentIds = options?.addressedAgentIds?.filter(Boolean) ?? []
    const body = {
      content,
      ...(addressedAgentIds.length ? { addressedAgentIds } : {}),
    }

    return request(`/api/conversations/${encodeURIComponent(conversationId)}/messages/send`, {
      method: "POST",
      body: JSON.stringify(body),
    })
  },

  cancelRun(runId: string): Promise<ActiveRunSnapshot> {
    return request(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
    })
  },

  decidePermission(
    runId: string,
    requestId: string,
    decision: PermissionDecisionBody
  ): Promise<unknown> {
    return request(
      `/api/runs/${encodeURIComponent(runId)}/permissions/${encodeURIComponent(requestId)}/decision`,
      {
        method: "POST",
        body: JSON.stringify(decision),
      }
    )
  },

  answerQuestion(
    runId: string,
    requestId: string,
    body: QuestionAnswerBody
  ): Promise<unknown> {
    return request(
      `/api/runs/${encodeURIComponent(runId)}/questions/${encodeURIComponent(requestId)}/answer`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    )
  },

  eventsUrl(runId: string, afterSequence = 0): string {
    const search = new URLSearchParams({
      afterSequence: String(afterSequence),
    })
    return `/api/runs/${encodeURIComponent(runId)}/events?${search}`
  },
}
