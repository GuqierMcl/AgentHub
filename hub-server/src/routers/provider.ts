import { Hono, Context } from 'hono'
import type { RuntimeClient } from '../lib/runtime'
import type { Logger } from 'pino'

declare module 'hono' {
  interface ContextVariableMap {
    runtimeClient: RuntimeClient
    logger: Logger
  }
}

const provider = new Hono()

provider.get('/api/providers', async (c: Context) => {
  const client = c.get('runtimeClient')
  const query = c.req.query()
  const queryString = new URLSearchParams(query).toString()
  const path = queryString ? `/providers?${queryString}` : '/providers'
  const { data, status } = await client.forward('GET', path)
  return c.json(data, status as 200)
})

provider.get('/api/providers/:id', async (c: Context) => {
  const client = c.get('runtimeClient')
  const id = c.req.param('id')!
  const { data, status } = await client.forward('GET', `/providers/${encodeURIComponent(id)}`)
  return c.json(data, status as 200)
})

provider.put('/api/providers/:id/config', async (c: Context) => {
  const client = c.get('runtimeClient')
  const id = c.req.param('id')!
  const body = await c.req.json()
  const { data, status } = await client.forward('PUT', `/providers/${encodeURIComponent(id)}/config`, body)
  return c.json(data, status as 200)
})

provider.put('/api/providers/:id/models/:modelId/config', async (c: Context) => {
  const client = c.get('runtimeClient')
  const id = c.req.param('id')!
  const modelId = c.req.param('modelId')!
  const body = await c.req.json()
  const { data, status } = await client.forward('PUT', `/providers/${encodeURIComponent(id)}/models/${encodeURIComponent(modelId)}/config`, body)
  return c.json(data, status as 200)
})

provider.post('/api/custom-providers', async (c: Context) => {
  const client = c.get('runtimeClient')
  const body = await c.req.json()
  const { data, status } = await client.forward('POST', '/custom-providers', body)
  return c.json(data, status as 201)
})

provider.put('/api/custom-providers/:id', async (c: Context) => {
  const client = c.get('runtimeClient')
  const id = c.req.param('id')!
  const body = await c.req.json()
  const { data, status } = await client.forward('PUT', `/custom-providers/${encodeURIComponent(id)}`, body)
  return c.json(data, status as 200)
})

provider.delete('/api/custom-providers/:id', async (c: Context) => {
  const client = c.get('runtimeClient')
  const id = c.req.param('id')!
  await client.forward('DELETE', `/custom-providers/${encodeURIComponent(id)}`)
  return c.json({ deleted: true })
})

provider.post('/api/catalog/refresh', async (c: Context) => {
  const client = c.get('runtimeClient')
  const { data, status } = await client.forward('POST', '/catalog/refresh')
  return c.json(data, status as 200)
})

provider.get('/api/runtime/health', async (c: Context) => {
  const client = c.get('runtimeClient')
  const { data, status } = await client.forward('GET', '/health')
  return c.json(data, status as 200)
})

export default provider