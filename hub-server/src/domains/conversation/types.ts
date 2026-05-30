import { z } from 'zod'

// ── 请求 Schema ──

export const ListConversationsQuerySchema = z.object({
  status: z.enum(['active', 'archived']).optional(),
})

export type ListConversationsQuery = z.infer<typeof ListConversationsQuerySchema>

export const CreateConversationBodySchema = z.object({
  title: z.string().min(1).max(200),
  mode: z.enum(['single', 'group']),
  orchestratorAgentId: z.string().min(1).optional(),
  agents: z
    .array(
      z.object({
        agentId: z.string().min(1),
      }),
    )
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const UpdateConversationBodySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(['active', 'archived']).optional(),
  orchestratorAgentId: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type CreateConversationBody = z.infer<typeof CreateConversationBodySchema>
export type UpdateConversationBody = z.infer<typeof UpdateConversationBodySchema>

export const DeleteConversationsBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
})
export type DeleteConversationsBody = z.infer<typeof DeleteConversationsBodySchema>

// ── 响应 DTO ──

export interface ConversationAgentItem {
  agentId: string
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
  lastMessageContent: string
  pinnedAt: string | null
  createdAt: string
  updatedAt: string
  agents: { agentId: string }[]
  metadata: Record<string, unknown> | null
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
