import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { RunPersistenceService } from '../services/run-persistence.service'
import {
  createMessagePin,
  listMessagePinsWithContent,
  countMessagePinsByConversation,
  deleteMessagePin,
  updateMessagePin,
  findMessagePinById,
} from '../repositories/message-pin.repo'
import { findMessageById } from '../repositories/message.repo'

declare module 'hono' {
  interface ContextVariableMap {
    runPersistenceService: RunPersistenceService
  }
}

const messages = new Hono()

const SendMessageAttachmentSchema = z.object({
  kind: z.literal('image'),
  assetId: z.string().trim().min(1),
}).strict()

const SendMessageBodySchema = z.object({
  content: z.string().trim().optional().default(''),
  addressedAgentIds: z.array(z.string().trim().min(1)).optional().default([]),
  replyToMessageId: z.string().trim().min(1).optional(),
  attachments: z.array(SendMessageAttachmentSchema).optional().default([]),
}).strict().superRefine((body, ctx) => {
  if (body.content.trim() || body.attachments.length > 0) return
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['content'],
    message: 'Message requires non-empty content or at least one attachment',
  })
})

const CreatePinBodySchema = z.object({
  messageId: z.string().trim().min(1),
  note: z.string().trim().max(500).optional(),
  sortOrder: z.number().int().optional(),
}).strict()

const UpdatePinBodySchema = z.object({
  note: z.string().trim().max(500).nullable().optional(),
  sortOrder: z.number().int().optional(),
}).strict()

const MAX_PINS_PER_CONVERSATION = 10

messages.get('/api/conversations/:conversationId/messages', async (c: Context) => {
  const service = c.get('runPersistenceService')
  const conversationId = c.req.param('conversationId')!
  const limit = parsePositiveInt(c.req.query('limit'))
  const offset = parseNonNegativeInt(c.req.query('offset'))
  const result = await service.listConversationMessages(conversationId, {
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  })
  return c.json(result)
})

messages.post('/api/conversations/:conversationId/messages/send', async (c: Context) => {
  const service = c.get('runPersistenceService')
  const conversationId = c.req.param('conversationId')!
  const body = await c.req.json().catch(() => null)
  const parsed = SendMessageBodySchema.safeParse(body)
  if (!parsed.success) {
    return c.json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.message,
      },
    }, 400)
  }
  const result = await service.sendMessage(conversationId, parsed.data.content, {
    addressedAgentIds: parsed.data.addressedAgentIds,
    replyToMessageId: parsed.data.replyToMessageId,
    ...(parsed.data.attachments.length > 0
      ? { attachments: parsed.data.attachments }
      : {}),
  })
  return c.json(result, 201)
})

messages.post('/api/conversations/:conversationId/messages/:messageId/regenerate', async (c: Context) => {
  const service = c.get('runPersistenceService')
  const conversationId = c.req.param('conversationId')!
  const messageId = c.req.param('messageId')!
  const result = await service.regenerateAssistantMessage(conversationId, messageId)
  return c.json(result, 201)
})

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function parseNonNegativeInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

// --- Pin CRUD endpoints ---

messages.post('/api/conversations/:conversationId/pins', async (c: Context) => {
  const conversationId = c.req.param('conversationId')!
  const body = await c.req.json().catch(() => null)
  const parsed = CreatePinBodySchema.safeParse(body)
  if (!parsed.success) {
    return c.json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
    }, 400)
  }

  // Verify message exists and belongs to this conversation
  const message = await findMessageById(parsed.data.messageId)
  if (!message || message.conversationId !== conversationId) {
    return c.json({
      error: { code: 'MESSAGE_NOT_FOUND', message: '消息不存在或不属于该会话' },
    }, 404)
  }

  // Check pin limit
  const currentCount = await countMessagePinsByConversation(conversationId)
  if (currentCount >= MAX_PINS_PER_CONVERSATION) {
    return c.json({
      error: { code: 'PIN_LIMIT_EXCEEDED', message: `单会话最多置顶 ${MAX_PINS_PER_CONVERSATION} 条消息` },
    }, 400)
  }

  try {
    const pin = await createMessagePin({
      conversationId,
      messageId: parsed.data.messageId,
      note: parsed.data.note,
      sortOrder: parsed.data.sortOrder,
    })
    return c.json(pin, 201)
  } catch (err: unknown) {
    // Unique constraint violation (already pinned)
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002') {
      return c.json({
        error: { code: 'PIN_ALREADY_EXISTS', message: '该消息已置顶' },
      }, 409)
    }
    throw err
  }
})

messages.get('/api/conversations/:conversationId/pins', async (c: Context) => {
  const conversationId = c.req.param('conversationId')!
  const pins = (await listMessagePinsWithContent(conversationId)).map((pin) => ({
    id: pin.id,
    conversationId: pin.conversationId,
    messageId: pin.messageId,
    messageContent: pin.messageContent,
    note: pin.note,
    sortOrder: pin.sortOrder,
    createdAt: pin.createdAt,
  }))
  return c.json({ pins })
})

messages.delete('/api/pins/:pinId', async (c: Context) => {
  const pinId = c.req.param('pinId')!
  const existing = await findMessagePinById(pinId)
  if (!existing) {
    return c.json({
      error: { code: 'PIN_NOT_FOUND', message: '置顶记录不存在' },
    }, 404)
  }
  await deleteMessagePin(pinId)
  return c.json({ deleted: true })
})

messages.patch('/api/pins/:pinId', async (c: Context) => {
  const pinId = c.req.param('pinId')!
  const body = await c.req.json().catch(() => null)
  const parsed = UpdatePinBodySchema.safeParse(body)
  if (!parsed.success) {
    return c.json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
    }, 400)
  }
  const existing = await findMessagePinById(pinId)
  if (!existing) {
    return c.json({
      error: { code: 'PIN_NOT_FOUND', message: '置顶记录不存在' },
    }, 404)
  }
  const updated = await updateMessagePin(pinId, parsed.data)
  return c.json(updated)
})

export default messages
