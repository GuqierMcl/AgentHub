import { z } from 'zod'
import type { AgentRole } from '../../lib/types'

// ── 请求 Schema ──

export const ListConversationsQuerySchema = z.object({
  status: z.enum(['active', 'archived']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const CreateConversationBodySchema = z.object({
  title: z.string().min(1).max(200),
  mode: z.enum(['single', 'group']),
  orchestratorAgentId: z.string().min(1).optional(),
  agents: z
    .array(
      z.object({
        agentId: z.string().min(1),
        role: z.enum(['primary', 'member', 'orchestrator'] as const),
      }),
    )
    .optional(),
  metadata: z.record(z.unknown()).optional(),
})

export const UpdateConversationBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(['active', 'archived']).optional(),
  orchestratorAgentId: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
})

// ── 推断类型 ──

export type ListConversationsQuery = z.infer<typeof ListConversationsQuerySchema>
export type CreateConversationBody = z.infer<typeof CreateConversationBodySchema>
export type UpdateConversationBody = z.infer<typeof UpdateConversationBodySchema>

// ── 响应 DTO ──

export interface ConversationAgentItem {
  agentId: string
  role: AgentRole
  sortOrder: number
  joinedAt: string
}

export interface ConversationListItem {
  id: string
  title: string
  mode: 'single' | 'group'
  status: 'active' | 'archived'
  orchestratorAgentId: string | null
  lastMessageId: string | null
  lastMessageAt: string | null
  pinnedAt: string | null
  createdAt: string
  updatedAt: string
  agents: { agentId: string; role: AgentRole }[]
}

export interface ConversationDetail {
  id: string
  title: string
  mode: 'single' | 'group'
  status: 'active' | 'archived'
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