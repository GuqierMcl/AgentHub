import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import { safeJsonParse } from '../lib/utils'
import type {
  MessageRole,
  SenderType,
  MessageStatus,
  FinishReason,
  MetadataJson,
  UiMessageJson,
  SortOrder,
  MessageSurface,
} from '../lib/types'

export interface CreateMessageInput {
  id?: string
  conversationId: string
  runId?: string | null
  runtimeMessageId?: string | null
  runtimeRunId?: string | null
  messageIndex?: number | null
  surface?: MessageSurface
  role: MessageRole
  senderType: SenderType
  senderId?: string | null
  agentId?: string | null
  taskId?: string | null
  groupId?: string | null
  parentMessageId?: string | null
  regeneratedFromId?: string | null
  status?: MessageStatus
  finishReason?: FinishReason
  firstEventSequence?: number | null
  lastEventSequence?: number | null
  metadataJson?: MetadataJson
  uiMessageJson?: UiMessageJson
  completedAt?: string | null
}

export interface UpdateMessageInput {
  runId?: string | null
  status?: MessageStatus
  finishReason?: FinishReason | null
  runtimeMessageId?: string | null
  runtimeRunId?: string | null
  messageIndex?: number | null
  surface?: MessageSurface
  taskId?: string | null
  groupId?: string | null
  firstEventSequence?: number | null
  lastEventSequence?: number | null
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
  runtimeMessageId: string | null
  runtimeRunId: string | null
  messageIndex: number | null
  surface: string
  role: string
  senderType: string
  senderId: string | null
  agentId: string | null
  taskId: string | null
  groupId: string | null
  parentMessageId: string | null
  regeneratedFromId: string | null
  status: string
  finishReason: string | null
  firstEventSequence: number | null
  lastEventSequence: number | null
  metadataJson: MetadataJson
  uiMessageJson: UiMessageJson | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

function toOutput(record: Record<string, unknown>): MessageOutput {
  return {
    ...record,
    metadataJson: safeJsonParse(record.metadataJson as string | undefined, {}),
    uiMessageJson: safeJsonParse(record.uiMessageJson as string | undefined, null),
  } as MessageOutput
}

export async function createMessage(input: CreateMessageInput): Promise<MessageOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  const record = await db.message.create({
    data: {
      id: input.id ?? generateId('msg'),
      conversationId: input.conversationId,
      runId: input.runId ?? null,
      runtimeMessageId: input.runtimeMessageId ?? null,
      runtimeRunId: input.runtimeRunId ?? null,
      messageIndex: input.messageIndex ?? null,
      surface: input.surface ?? 'chat',
      role: input.role,
      senderType: input.senderType,
      senderId: input.senderId ?? null,
      agentId: input.agentId ?? null,
      taskId: input.taskId ?? null,
      groupId: input.groupId ?? null,
      parentMessageId: input.parentMessageId ?? null,
      regeneratedFromId: input.regeneratedFromId ?? null,
      status: input.status ?? 'created',
      finishReason: input.finishReason ?? null,
      firstEventSequence: input.firstEventSequence ?? null,
      lastEventSequence: input.lastEventSequence ?? null,
      metadataJson: JSON.stringify(input.metadataJson ?? {}),
      uiMessageJson: input.uiMessageJson ? JSON.stringify(input.uiMessageJson) : null,
      createdAt: now,
      updatedAt: now,
      completedAt: input.completedAt ?? null,
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
  return sortMessages(records.map(r => toOutput(r as Record<string, unknown>)), order)
}

export async function listMessagesByRun(
  runId: string,
  status?: MessageStatus,
): Promise<MessageOutput[]> {
  const db = getPrismaClient()
  const records = await db.message.findMany({
    where: {
      runId,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: 'asc' },
  })
  return sortMessages(records.map(r => toOutput(r as Record<string, unknown>)))
}

export async function updateMessage(id: string, input: UpdateMessageInput): Promise<MessageOutput> {
  const db = getPrismaClient()
  const now = new Date().toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { updatedAt: now }
  if (input.runId !== undefined) data.runId = input.runId
  if (input.status !== undefined) data.status = input.status
  if (input.finishReason !== undefined) data.finishReason = input.finishReason
  if (input.runtimeMessageId !== undefined) data.runtimeMessageId = input.runtimeMessageId
  if (input.runtimeRunId !== undefined) data.runtimeRunId = input.runtimeRunId
  if (input.messageIndex !== undefined) data.messageIndex = input.messageIndex
  if (input.surface !== undefined) data.surface = input.surface
  if (input.taskId !== undefined) data.taskId = input.taskId
  if (input.groupId !== undefined) data.groupId = input.groupId
  if (input.firstEventSequence !== undefined) data.firstEventSequence = input.firstEventSequence
  if (input.lastEventSequence !== undefined) data.lastEventSequence = input.lastEventSequence
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

export async function listMessagesWithParts(
  conversationId: string,
  opts?: { limit?: number; offset?: number; order?: SortOrder },
) {
  const db = getPrismaClient()
  const records = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: opts?.order ?? 'asc' },
    include: { parts: { orderBy: { partIndex: 'asc' } } },
    take: opts?.limit ?? 50,
    skip: opts?.offset ?? 0,
  })
  return sortMessages(
    records.map((record) => toOutputWithParts(record as Record<string, unknown>)),
    opts?.order ?? 'asc',
  )
}

export async function listMessagesByIds(ids: string[]): Promise<MessageOutput[]> {
  if (!ids.length) return []
  const db = getPrismaClient()
  const records = await db.message.findMany({
    where: { id: { in: ids } },
  })
  return sortMessages(records.map((record) => toOutput(record as Record<string, unknown>)))
}

export async function listMessagesWithPartsByIds(ids: string[]) {
  if (!ids.length) return []
  const db = getPrismaClient()
  const records = await db.message.findMany({
    where: { id: { in: ids } },
    include: { parts: { orderBy: { partIndex: 'asc' } } },
  })
  return sortMessages(
    records.map((record) => toOutputWithParts(record as Record<string, unknown>)),
  )
}

export async function listMessagesWithPartsByRunIds(
  conversationId: string,
  runIds: string[],
) {
  if (!runIds.length) return []
  const db = getPrismaClient()
  const records = await db.message.findMany({
    where: {
      conversationId,
      runId: { in: runIds },
    },
    include: { parts: { orderBy: { partIndex: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  })
  return sortMessages(
    records.map((record) => toOutputWithParts(record as Record<string, unknown>)),
  )
}

export async function listStandaloneChatMessages(
  conversationId: string,
  order: SortOrder = 'desc',
): Promise<MessageOutput[]> {
  const db = getPrismaClient()
  const records = await db.message.findMany({
    where: {
      conversationId,
      runId: null,
      surface: 'chat',
      role: { in: ['user', 'assistant'] },
    },
    orderBy: { createdAt: order },
  })
  return sortMessages(
    records.map((record) => toOutput(record as Record<string, unknown>)),
    order,
  )
}

export async function findMessageByRunAndRuntimeMessageId(
  runId: string,
  runtimeMessageId: string,
): Promise<MessageOutput | null> {
  const db = getPrismaClient()
  const record = await db.message.findFirst({
    where: {
      runId,
      runtimeMessageId,
    },
  })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

function toOutputWithParts(record: Record<string, unknown>) {
  return {
    ...toOutput(record),
    parts: ((record.parts as Record<string, unknown>[] | undefined) ?? []).map((part) => ({
      ...part,
      payloadJson: safeJsonParse(part.payloadJson as string | undefined, {}),
    })),
  }
}

function sortMessages<T extends Pick<MessageOutput, 'id' | 'runId' | 'role' | 'firstEventSequence' | 'createdAt'>>(
  messages: T[],
  order: SortOrder = 'asc',
): T[] {
  const sorted = [...messages].sort((left, right) => {
    const leftSeq = getMessageOrderSequence(left)
    const rightSeq = getMessageOrderSequence(right)
    if (left.runId && right.runId && left.runId === right.runId && leftSeq !== undefined && rightSeq !== undefined && leftSeq !== rightSeq) {
      return leftSeq - rightSeq
    }
    const leftTime = Date.parse(left.createdAt)
    const rightTime = Date.parse(right.createdAt)
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime
    }
    return left.id.localeCompare(right.id)
  })
  return order === 'desc' ? sorted.reverse() : sorted
}

function getMessageOrderSequence(
  message: Pick<MessageOutput, 'role' | 'firstEventSequence'>,
): number | undefined {
  if (typeof message.firstEventSequence === 'number') {
    return message.firstEventSequence
  }
  if (message.role === 'user') {
    return 0
  }
  return undefined
}
