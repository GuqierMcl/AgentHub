import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import { safeJsonParse } from '../lib/utils'
import type { PartState, PayloadJson } from '../lib/types'

export interface CreateMessagePartInput {
  messageId: string
  conversationId: string
  runId?: string
  runtimeEventId?: string
  partKey: string
  partIndex: number
  entityType?: string
  entityId?: string
  type: string
  state?: PartState
  text?: string
  payloadJson?: PayloadJson
  firstEventSequence?: number | null
  lastEventSequence?: number | null
}

export interface UpdateMessagePartInput {
  runId?: string | null
  state?: PartState
  text?: string
  payloadJson?: PayloadJson
  entityType?: string | null
  entityId?: string | null
  firstEventSequence?: number | null
  lastEventSequence?: number | null
}

export interface MessagePartOutput {
  id: string
  messageId: string
  conversationId: string
  runId: string | null
  runtimeEventId: string | null
  partKey: string
  partIndex: number
  entityType: string | null
  entityId: string | null
  type: string
  state: string
  text: string | null
  payloadJson: PayloadJson
  firstEventSequence: number | null
  lastEventSequence: number | null
  createdAt: string
  updatedAt: string
}

function toOutput(record: Record<string, unknown>): MessagePartOutput {
  return {
    ...record,
    payloadJson: safeJsonParse(record.payloadJson as string | undefined, {}),
  } as MessagePartOutput
}

export async function createMessagePart(input: CreateMessagePartInput): Promise<MessagePartOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  const record = await db.messagePart.create({
    data: {
      id: generateId('part'),
      messageId: input.messageId,
      conversationId: input.conversationId,
      runId: input.runId ?? null,
      runtimeEventId: input.runtimeEventId ?? null,
      partKey: input.partKey,
      partIndex: input.partIndex,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      type: input.type,
      state: input.state ?? 'streaming',
      text: input.text ?? null,
      payloadJson: JSON.stringify(input.payloadJson ?? {}),
      firstEventSequence: input.firstEventSequence ?? null,
      lastEventSequence: input.lastEventSequence ?? null,
      createdAt: now,
      updatedAt: now,
    },
  })
  return toOutput(record as Record<string, unknown>)
}

export async function findMessagePartById(id: string): Promise<MessagePartOutput | null> {
  const db = getPrismaClient()
  const record = await db.messagePart.findUnique({ where: { id } })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function listMessagePartsByMessage(messageId: string): Promise<MessagePartOutput[]> {
  const db = getPrismaClient()
  const records = await db.messagePart.findMany({
    where: { messageId },
    orderBy: { partIndex: 'asc' },
  })
  return records.map(r => toOutput(r as Record<string, unknown>))
}

export async function findMessagePartByMessageAndKey(
  messageId: string,
  partKey: string,
): Promise<MessagePartOutput | null> {
  const db = getPrismaClient()
  const record = await db.messagePart.findFirst({
    where: {
      messageId,
      partKey,
    },
  })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function listMessagePartsByConversation(conversationId: string, opts?: { limit?: number; offset?: number }): Promise<MessagePartOutput[]> {
  const db = getPrismaClient()
  const records = await db.messagePart.findMany({
    where: { conversationId },
    orderBy: { partIndex: 'asc' },
    take: opts?.limit ?? 200,
    skip: opts?.offset ?? 0,
  })
  return records.map(r => toOutput(r as Record<string, unknown>))
}

export async function listMessagePartsByRun(runId: string): Promise<MessagePartOutput[]> {
  const db = getPrismaClient()
  const records = await db.messagePart.findMany({
    where: { runId },
    orderBy: { partIndex: 'asc' },
  })
  return records.map(r => toOutput(r as Record<string, unknown>))
}

export async function updateMessagePart(id: string, input: UpdateMessagePartInput): Promise<MessagePartOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { updatedAt: now }
  if (input.runId !== undefined) data.runId = input.runId
  if (input.state !== undefined) data.state = input.state
  if (input.text !== undefined) data.text = input.text
  if (input.payloadJson !== undefined) data.payloadJson = JSON.stringify(input.payloadJson)
  if (input.entityType !== undefined) data.entityType = input.entityType
  if (input.entityId !== undefined) data.entityId = input.entityId
  if (input.firstEventSequence !== undefined) data.firstEventSequence = input.firstEventSequence
  if (input.lastEventSequence !== undefined) data.lastEventSequence = input.lastEventSequence

  const record = await db.messagePart.update({ where: { id }, data })
  return toOutput(record as Record<string, unknown>)
}

export async function deleteMessagePart(id: string) {
  const db = getPrismaClient()
  return db.messagePart.delete({ where: { id } })
}

export async function deleteMessagePartsByMessage(messageId: string) {
  const db = getPrismaClient()
  return db.messagePart.deleteMany({ where: { messageId } })
}

export async function createMessageParts(inputs: CreateMessagePartInput[]): Promise<MessagePartOutput[]> {
  const db = getPrismaClient()
  const now = new Date().toISOString()
  const results = await db.$transaction(
    inputs.map(input =>
      db.messagePart.create({
        data: {
          id: generateId('part'),
          messageId: input.messageId,
          conversationId: input.conversationId,
          runId: input.runId ?? null,
          runtimeEventId: input.runtimeEventId ?? null,
          partKey: input.partKey,
          partIndex: input.partIndex,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          type: input.type,
          state: input.state ?? 'streaming',
          text: input.text ?? null,
          payloadJson: JSON.stringify(input.payloadJson ?? {}),
          firstEventSequence: input.firstEventSequence ?? null,
          lastEventSequence: input.lastEventSequence ?? null,
          createdAt: now,
          updatedAt: now,
        },
      })
    )
  )
  return results.map(r => toOutput(r as Record<string, unknown>))
}
