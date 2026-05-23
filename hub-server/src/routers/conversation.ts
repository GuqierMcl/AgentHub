import { Hono, Context } from 'hono'
import type { ConversationService } from '../services/conversation.service'
import type { Logger } from 'pino'
import {
  ListConversationsQuerySchema,
  CreateConversationBodySchema,
  UpdateConversationBodySchema,
} from '../domains/conversation/types'

declare module 'hono' {
  interface ContextVariableMap {
    conversationService: ConversationService
    logger: Logger
  }
}

const conversation = new Hono()

conversation.get('/api/conversations', async (c: Context) => {
  const service = c.get('conversationService')
  const raw = c.req.query()
  const parsed = ListConversationsQuerySchema.safeParse(raw)
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      400,
    )
  }

  const result = await service.listConversationsPaginated(parsed.data)
  return c.json(result)
})

conversation.post('/api/conversations', async (c: Context) => {
  const service = c.get('conversationService')
  const body = await c.req.json()
  const parsed = CreateConversationBodySchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      400,
    )
  }

  const result = await service.createConversationWithAgents(parsed.data)
  return c.json(result, 201)
})

conversation.get('/api/conversations/:id', async (c: Context) => {
  const service = c.get('conversationService')
  const id = c.req.param('id')!
  const result = await service.getConversationDetail(id)
  return c.json(result)
})

conversation.patch('/api/conversations/:id', async (c: Context) => {
  const service = c.get('conversationService')
  const id = c.req.param('id')!
  const body = await c.req.json()
  const parsed = UpdateConversationBodySchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      400,
    )
  }

  const result = await service.updateConversationFields(id, parsed.data)
  return c.json(result)
})

conversation.delete('/api/conversations/:id', async (c: Context) => {
  const service = c.get('conversationService')
  const id = c.req.param('id')!
  await service.deleteConversation(id)
  return c.body(null, 204)
})

conversation.post('/api/conversations/:id/pin', async (c: Context) => {
  const service = c.get('conversationService')
  const id = c.req.param('id')!
  const result = await service.pinConversation(id)
  return c.json(result)
})

conversation.post('/api/conversations/:id/unpin', async (c: Context) => {
  const service = c.get('conversationService')
  const id = c.req.param('id')!
  const result = await service.unpinConversation(id)
  return c.json(result)
})

export default conversation