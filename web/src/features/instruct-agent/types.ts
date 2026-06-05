import type { RuntimeRunEvent } from "@/features/workbench/api/runtime-runs"

export type InstructRunStatus =
  | "queued"
  | "running"
  | "waiting_input"
  | "completed"
  | "failed"
  | "cancelled"

export type InstructConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"

export type InstructHistoryMessage = {
  role: "user" | "assistant"
  content: string
}

export type InstructRunInput = {
  conversationId: string
  userMessage: {
    role: "user"
    content: string
  }
  history?: InstructHistoryMessage[]
  draft?: {
    id?: string
    name?: string
    description?: string
    systemPrompt?: string
    capabilities?: string[]
    allowedTools?: string[]
    allowedSubagents?: string[]
    permissionPolicy?: Record<string, unknown>
    toolPermissionRules?: Record<string, unknown>
  }
  diagnostics?: {
    includeModelStream?: boolean
    includeReasoning?: boolean
    includeRawModelChunks?: boolean
  }
}

export type InstructRunCreateResponse = {
  runId: string
  status: InstructRunStatus
  agentId: "instruct-agent"
  eventsUrl: string
}

export type InstructRunRecord = {
  runId: string
  conversationId: string
  status: InstructRunStatus
  agentId: "instruct-agent"
  createdAt: string
  updatedAt: string
  input: InstructRunInput
  error?: {
    code: string
    message: string
  }
}

export type InstructLastPromptResponse = {
  prompt: string | null
  updatedAt: string | null
}

export type InstructQuestionAnswerBody = {
  answers: Array<{
    questionId: string
    optionId?: string
    answer?: string
    custom?: boolean
  }>
}

export type InstructSavedAgent = {
  id: string
  name: string
  description: string
  capabilities: string[]
  allowedTools: string[]
  allowedSubagents: string[]
  permissionPolicy: Record<string, unknown>
  enabled: boolean
  readonly: boolean
  createdAt?: string
  updatedAt?: string
}

export type InstructRunEvent = RuntimeRunEvent
