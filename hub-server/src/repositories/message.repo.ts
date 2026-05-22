import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import type { MessageRole, SenderType, MessageStatus, FinishReason, MetadataJson, UiMessageJson, SortOrder } from '../lib/types'

export interface CreateMessageInput {
  conversationId: string
  runId?: string
  role: MessageRole
  senderType: SenderType
  senderId?: string
  agentId?: string
  parentMessageId?: string
  regeneratedFromId?: string
  status?: MessageStatus
  finishReason?: FinishReason
  metadataJson?: MetadataJson
  uiMessageJson?: UiMessageJson
}

export interface UpdateMessageInput {
  status?: MessageStatus
  finishReason?: FinishReason | null
  metadataJson?: MetadataJson
  uiMessageJson?: UiMessageJson | null
  completedAt?: string | null
}

export interface ListMessagesFilter {
  conversationId: string
  runId?: string
  status?: MessageStatus
  limit?: number
  offset?: number
  order?: SortOrder
}

export interface MessageOutput {
  id: string
  conversationId: string
  runId: string | null
  role: string
  senderType: string
  senderId: string | null
  agentId: string | null
  parentMessageId: string | null
  regeneratedFromId: string | null
  status: string
  finishReason: string | null
  metadataJson: MetadataJson
  uiMessageJson: UiMessageJson | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

function toOutput(record: Record<string, unknown>): MessageOutput {
  return {
    ...record,
    metadataJson: JSON.parse((record.metadataJson as string) || '{}'),
    uiMessageJson: record.uiMessageJson ? JSON.parse(record.uiMessageJson as string) : null,
  } as MessageOutput
}

export async function createMessage(input: CreateMessageInput): Promise<MessageOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  const record = await db.message.create({
    data: {
      id: generateId('msg'),
      conversationId: input.conversationId,
      runId: input.runId ?? null,
      role: input.role,
      senderType: input.senderType,
      senderId: input.senderId ?? null,
      agentId: input.agentId ?? null,
      parentMessageId: input.parentMessageId ?? null,
      regeneratedFromId: input.regeneratedFromId ?? null,
      status: input.status ?? 'created',
      finishReason: input.finishReason ?? null,
      metadataJson: JSON.stringify(input.metadataJson ?? {}),
      uiMessageJson: input.uiMessageJson ? JSON.stringify(input.uiMessageJson) : null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    },
  })
  return toOutput(record as Record<string, unknown>)
}

export async function findMessageById(id: string): Promise<MessageOutput | null> {
  const db = getPrismaClient()
  const record = await db.message.findUnique({ where: { id } })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function listMessages(filter: ListMessagesFilter): Promise<MessageOutput[]> {
  const db = getPrismaClient()
  const { conversationId, runId, status, limit = 50, offset = 0, order = 'asc' } = filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { conversationId }
  if (runId) where.runId = runId
  if (status) where.status = status

  const records = await db.message.findMany({
    where,
    orderBy: { createdAt: order },
    take: limit,
    skip: offset,
  })
  return records.map(r => toOutput(r as Record<string, unknown>))
}

export async function updateMessage(id: string, input: UpdateMessageInput): Promise<MessageOutput> {
  const db = getPrismaClient()
  const now = new Date().toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { updatedAt: now }
  if (input.status !== undefined) data.status = input.status
  if (input.finishReason !== undefined) data.finishReason = input.finishReason
  if (input.metadataJson !== undefined) data.metadataJson = JSON.stringify(input.metadataJson)
  if (input.uiMessageJson !== undefined) data.uiMessageJson = input.uiMessageJson ? JSON.stringify(input.uiMessageJson) : null
  if (input.completedAt !== undefined) data.completedAt = input.completedAt

  const record = await db.message.update({ where: { id }, data })
  return toOutput(record as Record<string, unknown>)
}

export async function deleteMessageById(id: string): Promise<void> {
  const db = getPrismaClient()
  await db.message.delete({ where: { id } })
}

export async function countMessages(filter: { conversationId: string; status?: MessageStatus }): Promise<number> {
  const db = getPrismaClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { conversationId: filter.conversationId }
  if (filter.status) where.status = filter.status
  return db.message.count({ where })
}

export async function findMessageWithParts(id: string) {
  const db = getPrismaClient()
  return db.message.findUnique({
    where: { id },
    include: { parts: { orderBy: { partIndex: 'asc' } } },
  })
}

export async function listMessagesWithParts(conversationId: string, opts?: { limit?: number; offset?: number }) {
  const db = getPrismaClient()
  return db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    include: { parts: { orderBy: { partIndex: 'asc' } } },
    take: opts?.limit ?? 50,
    skip: opts?.offset ?? 0,
  })
}