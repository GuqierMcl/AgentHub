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
      id: generateId('mp'),
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

export async function countMessagePinsByConversation(conversationId: string): Promise<number> {
  const db = getPrismaClient()
  return db.messagePin.count({ where: { conversationId } })
}

export interface MessagePinWithContent {
  id: string
  conversationId: string
  messageId: string
  note: string | null
  sortOrder: number
  createdAt: string
  messageContent: string | null
  messageRole: string
  messageSenderType: string
  messageSenderId: string | null
  messageAgentId: string | null
  messageParentMessageId: string | null
  messageCreatedAt: string
  messageMetadataJson: string
}

export async function listMessagePinsWithContent(conversationId: string): Promise<MessagePinWithContent[]> {
  const db = getPrismaClient()
  const records = await db.messagePin.findMany({
    where: { conversationId },
    include: {
      message: {
        select: {
          role: true,
          senderType: true,
          senderId: true,
          agentId: true,
          parentMessageId: true,
          createdAt: true,
          metadataJson: true,
          parts: {
            where: { type: 'text' },
            select: { text: true },
            take: 1,
            orderBy: { partIndex: 'asc' },
          },
        },
      },
    },
    orderBy: { sortOrder: 'asc' },
  })

  return records.map((record) => ({
    id: record.id,
    conversationId: record.conversationId,
    messageId: record.messageId,
    note: record.note,
    sortOrder: record.sortOrder,
    createdAt: record.createdAt,
    messageContent: record.message.parts[0]?.text ?? null,
    messageRole: record.message.role,
    messageSenderType: record.message.senderType,
    messageSenderId: record.message.senderId,
    messageAgentId: record.message.agentId,
    messageParentMessageId: record.message.parentMessageId,
    messageCreatedAt: record.message.createdAt,
    messageMetadataJson: record.message.metadataJson,
  }))
}
