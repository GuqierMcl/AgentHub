import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import type { PartState, PayloadJson } from '../lib/types'

export interface CreateMessagePartInput {
  messageId: string
  conversationId: string
  runId?: string
  partIndex: number
  type: string
  state?: PartState
  text?: string
  payloadJson?: PayloadJson
}

export interface UpdateMessagePartInput {
  state?: PartState
  text?: string
  payloadJson?: PayloadJson
}

export async function createMessagePart(input: CreateMessagePartInput) {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  return db.messagePart.create({
    data: {
      id: generateId('part'),
      messageId: input.messageId,
      conversationId: input.conversationId,
      runId: input.runId ?? null,
      partIndex: input.partIndex,
      type: input.type,
      state: input.state ?? 'streaming',
      text: input.text ?? null,
      payloadJson: JSON.stringify(input.payloadJson ?? {}),
      createdAt: now,
      updatedAt: now,
    },
  })
}

export async function findMessagePartById(id: string) {
  const db = getPrismaClient()
  return db.messagePart.findUnique({ where: { id } })
}

export async function listMessagePartsByMessage(messageId: string) {
  const db = getPrismaClient()
  return db.messagePart.findMany({
    where: { messageId },
    orderBy: { partIndex: 'asc' },
  })
}

export async function listMessagePartsByConversation(conversationId: string, opts?: { limit?: number; offset?: number }) {
  const db = getPrismaClient()
  return db.messagePart.findMany({
    where: { conversationId },
    orderBy: { partIndex: 'asc' },
    take: opts?.limit ?? 200,
    skip: opts?.offset ?? 0,
  })
}

export async function listMessagePartsByRun(runId: string) {
  const db = getPrismaClient()
  return db.messagePart.findMany({
    where: { runId },
    orderBy: { partIndex: 'asc' },
  })
}

export async function updateMessagePart(id: string, input: UpdateMessagePartInput) {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { updatedAt: now }
  if (input.state !== undefined) data.state = input.state
  if (input.text !== undefined) data.text = input.text
  if (input.payloadJson !== undefined) data.payloadJson = JSON.stringify(input.payloadJson)

  return db.messagePart.update({ where: { id }, data })
}

export async function deleteMessagePart(id: string) {
  const db = getPrismaClient()
  return db.messagePart.delete({ where: { id } })
}

export async function deleteMessagePartsByMessage(messageId: string) {
  const db = getPrismaClient()
  return db.messagePart.deleteMany({ where: { messageId } })
}

export async function createMessageParts(inputs: CreateMessagePartInput[]) {
  const db = getPrismaClient()
  const now = new Date().toISOString()
  return db.$transaction(
    inputs.map(input =>
      db.messagePart.create({
        data: {
          id: generateId('part'),
          messageId: input.messageId,
          conversationId: input.conversationId,
          runId: input.runId ?? null,
          partIndex: input.partIndex,
          type: input.type,
          state: input.state ?? 'streaming',
          text: input.text ?? null,
          payloadJson: JSON.stringify(input.payloadJson ?? {}),
          createdAt: now,
          updatedAt: now,
        },
      })
    )
  )
}