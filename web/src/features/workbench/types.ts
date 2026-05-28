import type { ToolUIPart } from "ai"
import type {
  AgentExecutorType,
  AgentOrigin,
  AgentResolvedModel,
} from "@/features/agents/types"

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

export type Artifact = {
  id: string
  type: ArtifactKind
  title: string
  description: string
  meta: string
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
}

export type WorkbenchTimelineChatMessageItem = {
  kind: "chat_message"
  id: string
  role: "user" | "assistant"
  runId?: string
  runtimeMessageId?: string
  messageIndex?: number
  agentId?: string
  text: string
  time: string
  status?: WorkbenchTimelineStatus
  error?: string
  reasoningBlocks?: WorkbenchTimelineReasoningBlock[]
  toolItems?: WorkbenchTimelineToolItem[]
  permissionItems?: WorkbenchTimelinePermissionItem[]
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
  toolCallId: string
  toolName: string
  title: string
  time: string
  status: ToolUIPart["state"]
  input?: unknown
  output?: unknown
  errorText?: string
}

export type WorkbenchTimelinePermissionItem = {
  kind: "permission"
  id: string
  runId: string
  requestId: string
  agentId?: string
  toolCallId?: string
  toolName?: string
  title: string
  reason?: string
  time: string
  status: ToolUIPart["state"]
  approved?: boolean
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
  | WorkbenchTimelineReasoningItem
  | WorkbenchTimelinePlanItem
  | WorkbenchTimelineRunStatusItem

export type WorkbenchMessage = WorkbenchTimelineChatMessageItem

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
  pinnedAt: string | null
  createdAt: string
  updatedAt: string
  agents: { agentId: string; role: AgentRole }[]
  metadata: Record<string, unknown> | null
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

