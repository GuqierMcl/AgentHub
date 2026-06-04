import type { ToolUIPart } from "ai"
import type {
  AgentExecutorType,
  AgentOrigin,
  AgentResolvedModel,
} from "@/features/agents/types"
import type {
  RuntimeExternalModel,
  RuntimeGeneration,
  RuntimeRunStatus,
} from "./api/runtime-runs"

export type AgentStatus = "online" | "busy" | "idle"

export type Agent = {
  id: string
  name: string
  shortName: string
  role: string
  status: AgentStatus
  capabilities: string[]
}

export type ArtifactKind = "code" | "preview" | "diff" | "deploy"

export type WorkspaceDiffArtifactDetail = {
  kind: "workspace-diff"
  workspaceDiff: Record<string, unknown>
  patchText?: string
}

export type Artifact = {
  id: string
  type: ArtifactKind
  title: string
  description: string
  meta: string
  sourceArtifactId?: string
  conversationId?: string
  detail?: WorkspaceDiffArtifactDetail
}

export type MessageVersion = {
  id: string
  content: string
}

export type MessageSource = {
  href: string
  title: string
}

export type MessageReasoning = {
  content: string
  duration: number
}

export type ToolTrace = {
  id: string
  name: string
  description: string
  status: ToolUIPart["state"]
  parameters: Record<string, unknown>
  result?: string
  error?: string
}

export type WorkbenchTimelineStatus =
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled"

export type WorkbenchTimelineReasoningBlock = {
  reasoningId: string
  messageId?: string
  messageIndex?: number
  text: string
  time: string
  startedAt?: string
  completedAt?: string
  duration?: number
  status: "streaming" | "completed"
  // Monotonic position among sibling nested blocks (reasoning/tool/permission/
  // question) of the same message or task, assigned on first creation so the UI
  // can render them in genuine interleaved order rather than bucketed by kind.
  order?: number
}

export type WorkbenchTimelineChatMessageItem = {
  kind: "chat_message"
  id: string
  persistedMessageId?: string
  role: "user" | "assistant"
  runId?: string
  runtimeMessageId?: string
  messageIndex?: number
  agentId?: string
  text: string
  time: string
  status?: WorkbenchTimelineStatus
  error?: string
  generation?: RuntimeGeneration
  externalModel?: RuntimeExternalModel
  reasoningBlocks?: WorkbenchTimelineReasoningBlock[]
  toolItems?: WorkbenchTimelineToolItem[]
  permissionItems?: WorkbenchTimelinePermissionItem[]
  questionItems?: WorkbenchTimelineQuestionItem[]
  versions?: MessageVersion[]
  sources?: MessageSource[]
  artifacts?: Artifact[]
}

export type WorkbenchTimelineTaskItem = {
  kind: "task"
  id: string
  runId: string
  taskId: string
  agentId?: string
  parentAgentId?: string
  title: string
  targetAgentId?: string
  text: string
  time: string
  status: "pending" | "running" | "completed" | "failed"
  error?: string
  transcriptMessages?: WorkbenchTimelineTaskTranscriptMessage[]
  reasoningBlocks?: WorkbenchTimelineReasoningBlock[]
  toolItems?: WorkbenchTimelineToolItem[]
  permissionItems?: WorkbenchTimelinePermissionItem[]
  questionItems?: WorkbenchTimelineQuestionItem[]
}

export type WorkbenchTimelineTaskTranscriptMessage = {
  messageId: string
  messageIndex?: number
  text: string
}

export type WorkbenchTimelineToolItem = {
  kind: "tool"
  id: string
  runId: string
  agentId?: string
  externalProvider?: string
  toolCallId: string
  toolName: string
  title: string
  time: string
  status: ToolUIPart["state"]
  input?: unknown
  output?: unknown
  errorText?: string
  order?: number
}

export type WorkbenchTimelinePermissionItem = {
  kind: "permission"
  id: string
  runId: string
  requestId: string
  agentId?: string
  toolCallId?: string
  toolName?: string
  externalProvider?: string
  permissionKind?: string
  permissionType?: string
  target?: string
  title: string
  reason?: string
  time: string
  status: ToolUIPart["state"]
  approved?: boolean
  order?: number
}

export type WorkbenchTimelineQuestionOption = {
  id: string
  label: string
  value?: string
  description?: string
}

export type WorkbenchTimelineQuestion = {
  id: string
  title: string
  body: string
  options: WorkbenchTimelineQuestionOption[]
  allowCustom: boolean
  required: boolean
}

export type WorkbenchTimelineQuestionAnswer = {
  questionId: string
  optionId?: string
  answer?: string
  custom?: boolean
}

export type WorkbenchTimelineQuestionItem = {
  kind: "question"
  id: string
  runId: string
  requestId: string
  agentId?: string
  toolCallId?: string
  toolName?: string
  messageId?: string
  messageIndex?: number
  title: string
  questions: WorkbenchTimelineQuestion[]
  answers?: WorkbenchTimelineQuestionAnswer[]
  time: string
  status: "pending" | "answered" | "cancelled"
  order?: number
}

export type WorkbenchTimelineReasoningItem = {
  kind: "reasoning"
  id: string
  runId: string
  reasoningId: string
  agentId?: string
  text: string
  time: string
  startedAt?: string
  completedAt?: string
  duration?: number
  status: "streaming" | "completed"
}

export type WorkbenchTimelinePlanTask = {
  taskId: string
  title: string
  targetAgentId?: string
  status?: string
}

export type WorkbenchTimelinePlanItem = {
  kind: "plan"
  id: string
  runId: string
  agentId?: string
  title: string
  description: string
  time: string
  status: "streaming" | "completed"
  tasks: WorkbenchTimelinePlanTask[]
}

export type WorkbenchTimelineRunStatusItem = {
  kind: "run_status"
  id: string
  runId?: string
  text: string
  time: string
  status: "failed" | "cancelled"
  error?: string
}

export type WorkbenchTimelineItem =
  | WorkbenchTimelineChatMessageItem
  | WorkbenchTimelineTaskItem
  | WorkbenchTimelineToolItem
  | WorkbenchTimelinePermissionItem
  | WorkbenchTimelineQuestionItem
  | WorkbenchTimelineReasoningItem
  | WorkbenchTimelinePlanItem
  | WorkbenchTimelineRunStatusItem

export type WorkbenchMessage = WorkbenchTimelineChatMessageItem

export type MentionTarget = {
  kind: "agent"
  id: string
  label: string
  shortLabel?: string
}

export type ChatSubmitInput = {
  content: string
  addressedAgentIds?: string[]
}

export type Conversation = {
  id: string
  title: string
  mode: "single" | "group"
  agentIds: string[]
  agents?: ConversationAgentProfile[]
  preview: string
  activeAt: string
  workspace: string
  unread?: number
  pinned?: boolean
  archived?: boolean
  running?: boolean
  timelineItems: WorkbenchTimelineItem[]
}

// Backend API types

export type AgentRole = "primary" | "member" | "orchestrator"

export type ConversationAgentProfile = {
  id: string
  name: string
  shortName?: string
  role: AgentRole
  origin?: AgentOrigin
  executorType?: AgentExecutorType
  capabilities: string[]
  enabled?: boolean
  resolvedModel?: AgentResolvedModel
}

export type ConversationListItem = {
  id: string
  title: string
  mode: "single" | "group"
  status: "active" | "archived"
  orchestratorAgentId: string | null
  lastMessageId: string | null
  lastMessageAt: string | null
  lastMessageContent: string
  pinnedAt: string | null
  createdAt: string
  updatedAt: string
  agents: { agentId: string; role: AgentRole }[]
  metadata: Record<string, unknown> | null
}

export type ConversationListDisplayItem = ConversationListItem & {
  activeRunStatus: RuntimeRunStatus | "submitted" | null
}

export type ConversationAgentItem = {
  agentId: string
  role: AgentRole
  sortOrder: number
  joinedAt: string
}

export type ConversationDetail = {
  id: string
  title: string
  mode: "single" | "group"
  status: "active" | "archived"
  orchestratorAgentId: string | null
  lastMessageId: string | null
  lastMessageAt: string | null
  pinnedAt: string | null
  archivedAt: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  agents: ConversationAgentItem[]
}

export type CreateConversationBody = {
  title: string
  mode: "single" | "group"
  orchestratorAgentId?: string
  agents?: { agentId: string }[]
  metadata?: Record<string, unknown>
}
