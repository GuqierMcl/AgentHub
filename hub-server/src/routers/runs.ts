import { Hono, Context } from 'hono'
import type { RuntimeClient } from '../lib/runtime'
import type { Logger } from 'pino'
import { config } from '../config'

declare module 'hono' {
  interface ContextVariableMap {
    runtimeClient: RuntimeClient
    logger: Logger
  }
}

const runs = new Hono()

runs.post('/api/runtime/runs', async (c: Context) => {
  const client = c.get('runtimeClient')
  const body = await c.req.json()
  const { data, status } = await client.forward('POST', '/runtime/runs', body, { raw: true })
  return c.json(data, status as 200)
})

runs.get('/api/runtime/runs/:runId', async (c: Context) => {
  const client = c.get('runtimeClient')
  const runId = c.req.param('runId')!
  const { data, status } = await client.forward('GET', `/runtime/runs/${encodeURIComponent(runId)}`, undefined, { raw: true })
  return c.json(data, status as 200)
})

runs.get('/api/runtime/runs/:runId/events', async (c: Context) => {
  const runId = c.req.param('runId')!
  const url = `${config.runtimeUrl}/runtime/runs/${encodeURIComponent(runId)}/events`
  const response = await fetch(url)
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})

runs.get('/api/runtime/runs/:runId/permissions', async (c: Context) => {
  const client = c.get('runtimeClient')
  const runId = c.req.param('runId')!
  const { data, status } = await client.forward('GET', `/runtime/runs/${encodeURIComponent(runId)}/permissions`, undefined, { raw: true })
  return c.json(data, status as 200)
})

runs.post('/api/runtime/runs/:runId/permissions/:requestId/decision', async (c: Context) => {
  const client = c.get('runtimeClient')
  const runId = c.req.param('runId')!
  const requestId = c.req.param('requestId')!
  const body = await c.req.json()
  const { data, status } = await client.forward('POST', `/runtime/runs/${encodeURIComponent(runId)}/permissions/${encodeURIComponent(requestId)}/decision`, body, { raw: true })
  return c.json(data, status as 200)
})

runs.post('/api/runtime/runs/:runId/cancel', async (c: Context) => {
  const client = c.get('runtimeClient')
  const runId = c.req.param('runId')!
  const { data, status } = await client.forward('POST', `/runtime/runs/${encodeURIComponent(runId)}/cancel`, undefined, { raw: true })
  return c.json(data, status as 200)
})

export default runs