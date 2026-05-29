import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { RunPersistenceService } from '../services/run-persistence.service'

declare module 'hono' {
  interface ContextVariableMap {
    runPersistenceService: RunPersistenceService
  }
}

const messages = new Hono()

const SendMessageBodySchema = z.object({
  content: z.string().trim().min(1),
}).strict()

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
  const result = await service.sendMessage(conversationId, parsed.data.content)
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

export default messages
