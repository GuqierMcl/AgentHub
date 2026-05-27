import type { ToolUIPart } from "ai"

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

export type WorkbenchMessage = {
  id: string
  role: "user" | "assistant"
  agentId?: string
  text: string
  time: string
  versions?: MessageVersion[]
  sources?: MessageSource[]
  reasoning?: MessageReasoning
  tools?: ToolTrace[]
  artifacts?: Artifact[]
}

export type Conversation = {
  id: string
  title: string
  mode: "single" | "group"
  agentIds: string[]
  preview: string
  activeAt: string
  workspace: string
  unread?: number
  pinned?: boolean
  archived?: boolean
  running?: boolean
  messages: WorkbenchMessage[]
}

// Backend API types

export type AgentRole = "primary" | "member" | "orchestrator"

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
  agents?: { agentId: string; role: AgentRole }[]
  metadata?: Record<string, unknown>
}

