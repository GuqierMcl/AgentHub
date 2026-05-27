import { Hono, Context } from 'hono'
import type { RuntimeClient } from '../lib/runtime'
import type { ConversationService } from '../services/conversation.service'
import type { Logger } from 'pino'
import { findConversationAgentsByAgentId } from '../repositories/conversation-agent.repo'

declare module 'hono' {
  interface ContextVariableMap {
    runtimeClient: RuntimeClient
    conversationService: ConversationService
    logger: Logger
  }
}

const agent = new Hono()

agent.post('/api/runtime/agents', async (c: Context) => {
  const client = c.get('runtimeClient')
  const body = await c.req.json()
  const { data, status } = await client.forward('POST', '/runtime/agents', body, { raw: true })
  return c.json(data, status as 200)
})

agent.get('/api/runtime/agents', async (c: Context) => {
  const client = c.get('runtimeClient')
  const query = c.req.query()
  const queryString = new URLSearchParams(query).toString()
  const path = queryString ? `/runtime/agents?${queryString}` : '/runtime/agents'
  const { data, status } = await client.forward('GET', path, undefined, { raw: true })
  return c.json(data, status as 200)
})

agent.get('/api/runtime/agents/authoring-options', async (c: Context) => {
  const client = c.get('runtimeClient')
  const { data, status } = await client.forward('GET', '/runtime/agents/authoring-options', undefined, { raw: true })
  return c.json(data, status as 200)
})

agent.get('/api/runtime/agents/:agentId', async (c: Context) => {
  const client = c.get('runtimeClient')
  const agentId = c.req.param('agentId')!
  const query = c.req.query()
  const queryString = new URLSearchParams(query).toString()
  const path = queryString ? `/runtime/agents/${encodeURIComponent(agentId)}?${queryString}` : `/runtime/agents/${encodeURIComponent(agentId)}`
  const { data, status } = await client.forward('GET', path, undefined, { raw: true })
  return c.json(data, status as 200)
})

agent.put('/api/runtime/agents/:agentId', async (c: Context) => {
  const client = c.get('runtimeClient')
  const agentId = c.req.param('agentId')!
  const body = await c.req.json()
  const { data, status } = await client.forward('PUT', `/runtime/agents/${encodeURIComponent(agentId)}`, body, { raw: true })
  return c.json(data, status as 200)
})

agent.delete('/api/runtime/agents/:agentId', async (c: Context) => {
  const client = c.get('runtimeClient')
  const service = c.get('conversationService')
  const logger = c.get('logger')
  const agentId = c.req.param('agentId')!

  const records = await findConversationAgentsByAgentId(agentId)
  if (records.length > 0) {
    const convIds = [...new Set(records.map((r) => r.conversationId))]
    logger.info({ agentId, conversationIds: convIds }, 'Archiving conversations that contain the agent being deleted')
    await Promise.all(convIds.map((convId) => service.archiveConversation(convId)))
  }

  const { data, status } = await client.forward('DELETE', `/runtime/agents/${encodeURIComponent(agentId)}`, undefined, { raw: true })
  return c.json(data, status as 200)
})

agent.put('/api/runtime/agents/:agentId/model', async (c: Context) => {
  const client = c.get('runtimeClient')
  const agentId = c.req.param('agentId')!
  const body = await c.req.json()
  const { data, status } = await client.forward('PUT', `/runtime/agents/${encodeURIComponent(agentId)}/model`, body, { raw: true })
  return c.json(data, status as 200)
})

agent.delete('/api/runtime/agents/:agentId/model', async (c: Context) => {
  const client = c.get('runtimeClient')
  const agentId = c.req.param('agentId')!
  const { data, status } = await client.forward('DELETE', `/runtime/agents/${encodeURIComponent(agentId)}/model`, undefined, { raw: true })
  return c.json(data, status as 200)
})

export default agent