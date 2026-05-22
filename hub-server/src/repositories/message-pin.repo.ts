import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'

export interface CreateMessagePinInput {
  conversationId: string
  messageId: string
  note?: string
  sortOrder?: number
}

export interface UpdateMessagePinInput {
  note?: string | null
  sortOrder?: number
}

export async function createMessagePin(input: CreateMessagePinInput) {
  const db = getPrismaClient()
  return db.messagePin.create({
    data: {
      id: generateId('part'),
      conversationId: input.conversationId,
      messageId: input.messageId,
      note: input.note ?? null,
      sortOrder: input.sortOrder ?? 0,
      createdAt: new Date().toISOString(),
    },
  })
}

export async function findMessagePinById(id: string) {
  const db = getPrismaClient()
  return db.messagePin.findUnique({ where: { id } })
}

export async function listMessagePinsByConversation(conversationId: string) {
  const db = getPrismaClient()
  return db.messagePin.findMany({
    where: { conversationId },
    orderBy: { sortOrder: 'asc' },
  })
}

export async function updateMessagePin(id: string, input: UpdateMessagePinInput) {
  const db = getPrismaClient()
  return db.messagePin.update({ where: { id }, data: { ...input } })
}

export async function deleteMessagePin(id: string) {
  const db = getPrismaClient()
  return db.messagePin.delete({ where: { id } })
}

export async function deleteMessagePinsByConversation(conversationId: string) {
  const db = getPrismaClient()
  return db.messagePin.deleteMany({ where: { conversationId } })
}