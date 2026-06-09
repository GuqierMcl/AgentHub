import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { z } from 'zod'
import type { RuntimeClient } from '../lib/runtime'
import { RemoteServerService } from '../services/remote-server.service'

const service = new RemoteServerService()
const router = new Hono()
const DisconnectDeploymentConnectionSchema = z.object({
  reason: z.string().trim().min(1).max(1_000).optional(),
}).strict()

declare module 'hono' {
  interface ContextVariableMap {
    runtimeClient: RuntimeClient
  }
}

async function requireRuntimeToken(c: Context, next: Next): Promise<Response | void> {
  const expected = c.get('runtimeInternalToken') as string | undefined
  if (!expected) {
    await next()
    return
  }

  const actual = c.req.header('x-agenthub-runtime-token')
  if (!actual || actual !== expected) {
    return c.json({ error: { code: 'RUNTIME_TOKEN_INVALID', message: 'Invalid Runtime token' } }, 403)
  }

  await next()
}

router.use('/internal/runtime/deployment/*', requireRuntimeToken)

router.get('/internal/runtime/deployment/servers', async (c: Context) => {
  const servers = await service.listForDeployment()
  return c.json({ servers })
})

router.get('/internal/runtime/deployment/servers/:id/material', async (c: Context) => {
  const id = c.req.param('id')!
  try {
    const material = await service.getDeploymentMaterial(id)
    return c.json(material)
  } catch (err) {
    if (err instanceof Error && err.message === 'Server not found') {
      return c.json({ error: { code: 'REMOTE_SERVER_NOT_FOUND', message: 'Server not found' } }, 404)
    }
    throw err
  }
})

router.post('/api/deployments/connections/:connectionId/disconnect', async (c: Context) => {
  const client = c.get('runtimeClient')
  const connectionId = c.req.param('connectionId')!
  const body = await c.req.json().catch(() => ({}))
  const parsed = DisconnectDeploymentConnectionSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return c.json({
      error: {
        code: 'DEPLOYMENT_INVALID_INPUT',
        message: 'Invalid deployment disconnect input',
        details: parsed.error.issues,
      },
    }, 400)
  }

  const { data, status } = await client.forward(
    'POST',
    `/runtime/deployments/connections/${encodeURIComponent(connectionId)}/close`,
    { reason: parsed.data.reason ?? 'manual_disconnect' },
    { raw: true },
  )
  return c.json(data, status as 200)
})

export default router
