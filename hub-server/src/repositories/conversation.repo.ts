import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import { safeJsonParse } from '../lib/utils'
import type { ConversationMode, ConversationStatus, SortOrder, MetadataJson } from '../lib/types'

export interface CreateConversationInput {
  title: string
  mode: ConversationMode
  status?: ConversationStatus
  orchestratorAgentId?: string
  metadataJson?: MetadataJson
}

export interface UpdateConversationInput {
  title?: string
  status?: ConversationStatus
  orchestratorAgentId?: string | null
  lastMessageId?: string | null
  lastMessageAt?: string | null
  pinnedAt?: string | null
  archivedAt?: string | null
  metadataJson?: MetadataJson
}

export interface ListConversationsFilter {
  status?: ConversationStatus
  pinnedOnly?: boolean
  limit?: number
  offset?: number
  order?: SortOrder
}

export interface ConversationOutput {
  id: string
  title: string
  mode: string
  status: string
  orchestratorAgentId: string | null
  lastMessageId: string | null
  lastMessageAt: string | null
  pinnedAt: string | null
  archivedAt: string | null
  metadataJson: MetadataJson
  createdAt: string
  updatedAt: string
}

function toOutput(record: Record<string, unknown>): ConversationOutput {
  return {
    ...record,
    metadataJson: safeJsonParse(record.metadataJson as string | undefined, {}),
  } as ConversationOutput
}

export async function createConversation(input: CreateConversationInput): Promise<ConversationOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  const record = await db.conversation.create({
    data: {
      id: generateId('conv'),
      title: input.title,
      mode: input.mode,
      status: input.status ?? 'active',
      orchestratorAgentId: input.orchestratorAgentId ?? null,
      metadataJson: JSON.stringify(input.metadataJson ?? {}),
      createdAt: now,
      updatedAt: now,
    },
  })
  return toOutput(record)
}

export async function findConversationById(id: string): Promise<ConversationOutput | null> {
  const db = getPrismaClient()
  const record = await db.conversation.findUnique({ where: { id } })
  if (!record) return null
  return toOutput(record)
}

export async function listConversations(filter: ListConversationsFilter = {}): Promise<ConversationOutput[]> {
  const db = getPrismaClient()
  const { status, pinnedOnly, limit = 50, offset = 0, order = 'desc' } = filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {}
  if (status) where.status = status
  if (pinnedOnly) where.pinnedAt = { not: null }

  const records = await db.conversation.findMany({
    where,
    orderBy: [{ pinnedAt: 'desc' }, { lastMessageAt: order }],
    take: limit,
    skip: offset,
  })
  return records.map(r => toOutput(r as Record<string, unknown>))
}

function toListOutput(record: Record<string, unknown>): ConversationListOutput {
  const agents = (record.agents as Record<string, unknown>[]) ?? []
  return {
    ...Object.fromEntries(
      Object.entries(record).filter(([k]) => k !== 'agents')
    ),
    metadataJson: safeJsonParse(record.metadataJson as string | undefined, {}),
    agents: agents.map((a) => ({
      agentId: a.agentId as string,
    })),
    lastMessageContent: typeof record.lastMessageContent === 'string' ? record.lastMessageContent : '',
  } as ConversationListOutput
}

export async function listConversationsWithAgents(filter: ListConversationsFilter = {}): Promise<ConversationListOutput[]> {
  const db = getPrismaClient()
  const { status, pinnedOnly, limit, offset = 0, order = 'desc' } = filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {}
  if (status) where.status = status
  if (pinnedOnly) where.pinnedAt = { not: null }

  const records = await db.conversation.findMany({
    where,
    orderBy: [{ pinnedAt: 'desc' }, { lastMessageAt: order }],
    ...(limit !== undefined ? { take: limit, skip: offset } : {}),
    include: { agents: { orderBy: { sortOrder: 'asc' } } },
  })

  const lastMessageIds = records
    .map((record) => record.lastMessageId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)

  const lastMessages = lastMessageIds.length > 0
    ? await db.message.findMany({
        where: { id: { in: lastMessageIds } },
        include: { parts: { orderBy: { partIndex: 'asc' } } },
      })
    : []

  const contentByMessageId = new Map(
    lastMessages.map((message) => [
      message.id,
      buildMessagePreview(
        message.parts.map((part) => ({
          type: part.type,
          text: part.text,
        })),
      ),
    ]),
  )

  return records.map((record) => toListOutput({
    ...(record as Record<string, unknown>),
    lastMessageContent: record.lastMessageId ? contentByMessageId.get(record.lastMessageId) ?? '' : '',
  }))
}

export async function updateConversation(id: string, input: UpdateConversationInput): Promise<ConversationOutput> {
  const db = getPrismaClient()
  const now = new Date().toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { updatedAt: now }
  if (input.title !== undefined) data.title = input.title
  if (input.status !== undefined) data.status = input.status
  if (input.orchestratorAgentId !== undefined) data.orchestratorAgentId = input.orchestratorAgentId
  if (input.lastMessageId !== undefined) data.lastMessageId = input.lastMessageId
  if (input.lastMessageAt !== undefined) data.lastMessageAt = input.lastMessageAt
  if (input.pinnedAt !== undefined) data.pinnedAt = input.pinnedAt
  if (input.archivedAt !== undefined) data.archivedAt = input.archivedAt
  if (input.metadataJson !== undefined) data.metadataJson = JSON.stringify(input.metadataJson)

  const record = await db.conversation.update({ where: { id }, data })
  return toOutput(record as Record<string, unknown>)
}

export async function deleteConversationById(id: string): Promise<void> {
  const db = getPrismaClient()
  await db.conversation.delete({ where: { id } })
}

export async function countConversations(filter: { status?: ConversationStatus } = {}): Promise<number> {
  const db = getPrismaClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {}
  if (filter.status) where.status = filter.status
  return db.conversation.count({ where })
}

export async function findConversationWithAgents(id: string): Promise<ConversationDetailOutput | null> {
  const db = getPrismaClient()
  const record = await db.conversation.findUnique({
    where: { id },
    include: { agents: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!record) return null
  return toConversationDetailOutput(record)
}

export interface ConversationDetailOutput {
  id: string
  title: string
  mode: string
  status: string
  orchestratorAgentId: string | null
  lastMessageId: string | null
  lastMessageAt: string | null
  pinnedAt: string | null
  archivedAt: string | null
  metadataJson: MetadataJson
  createdAt: string
  updatedAt: string
  agents: ConversationAgentDetailOutput[]
}

export interface ConversationListAgentOutput {
  agentId: string
}

export interface ConversationListOutput {
  id: string
  title: string
  mode: string
  status: string
  orchestratorAgentId: string | null
  lastMessageId: string | null
  lastMessageAt: string | null
  lastMessageContent?: string
  pinnedAt: string | null
  archivedAt: string | null
  metadataJson: MetadataJson
  createdAt: string
  updatedAt: string
  agents: ConversationListAgentOutput[]
}

export interface ConversationAgentDetailOutput {
  id: string
  conversationId: string
  agentId: string
  sortOrder: number
  joinedAt: string
}

function toConversationDetailOutput(record: Record<string, unknown>): ConversationDetailOutput {
  const agents = (record.agents as Record<string, unknown>[]) ?? []
  return {
    ...Object.fromEntries(
      Object.entries(record).filter(([k]) => k !== 'agents')
    ),
    metadataJson: safeJsonParse(record.metadataJson as string | undefined, {}),
    agents: agents.map((a) => ({
      id: a.id as string,
      conversationId: a.conversationId as string,
      agentId: a.agentId as string,
      sortOrder: a.sortOrder as number,
      joinedAt: a.joinedAt as string,
    })),
  } as ConversationDetailOutput
}

function buildMessagePreview(parts: { type: string; text: string | null }[]): string {
  const content = parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(content).slice(0, 50).join('')
}
