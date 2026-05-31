export type RuntimeConversationMode = "single" | "group"

export type RuntimeRunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled"

export type RuntimeMessage = {
  id?: string
  role: "user" | "assistant" | "system"
  agentId?: string
  content: string
}

export type RuntimeRunInput = {
  conversationId: string
  mode: RuntimeConversationMode
  participantAgentIds: string[]
  addressedAgentIds?: string[]
  userMessage: RuntimeMessage & { role: "user" }
  history: RuntimeMessage[]
  conversationState?: {
    messageCountBeforeRun?: number
    titleSource?: "default" | "auto" | "manual"
    titleSeedUserMessage?: string
  }
  workspace?: {
    workspaceId: string
    backendType: "local"
    rootPath: string
  }
  diagnostics?: {
    includeModelStream?: boolean
    includeReasoning?: boolean
    includeRawModelChunks?: boolean
  }
}

export type RuntimeRunCreateResponse = {
  runId: string
  status: RuntimeRunStatus
  entryAgentIds: string[]
  entryReason:
    | "single_participant"
    | "group_default_orchestrator"
    | "group_addressed_agent"
  eventsUrl: string
}

export type RuntimeRunEvent = {
  id: string
  runId: string
  runtimeRunId?: string | null
  type: string
  timestamp: string
  agentId?: string
  parentAgentId?: string
  parentTaskId?: string
  taskId?: string
  groupId?: string
  toolCallId?: string
  toolName?: string
  messageId?: string
  messageIndex?: number
  data?: unknown
}

type ErrorBody = {
  error?: {
    code?: string
    message?: string
    details?: unknown
  }
}

export class RuntimeRunRequestError extends Error {
  code?: string
  details?: unknown

  constructor(message: string, code?: string, details?: unknown) {
    super(message)
    this.name = "RuntimeRunRequestError"
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
    throw new RuntimeRunRequestError(message, body.error?.code, body.error?.details)
  }

  return res.json()
}

export const runtimeRunsApi = {
  create(input: RuntimeRunInput): Promise<RuntimeRunCreateResponse> {
    return request("/api/runtime/runs", {
      method: "POST",
      body: JSON.stringify(input),
    })
  },

  cancel(runId: string): Promise<unknown> {
    return request(`/api/runtime/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
    })
  },

  eventsUrl(runId: string): string {
    return `/api/runtime/runs/${encodeURIComponent(runId)}/events`
  },
}
