import { Hono } from 'hono'
import type { Context } from 'hono'
import { RemoteServerService } from '../services/remote-server.service'
import {
  CreateRemoteServerSchema,
  UpdateRemoteServerSchema,
  ImportSshConfigSchema,
} from '../domains/remote-server/types'

const service = new RemoteServerService()
const router = new Hono()

router.get('/api/remote-servers', async (c: Context) => {
  const servers = await service.list()
  return c.json({ servers })
})

router.post('/api/remote-servers', async (c: Context) => {
  const body = await c.req.json()
  const parsed = CreateRemoteServerSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400)
  }
  const server = await service.create(parsed.data)
  return c.json(server, 201)
})

router.put('/api/remote-servers/:id', async (c: Context) => {
  const id = c.req.param('id')!
  const body = await c.req.json()
  const parsed = UpdateRemoteServerSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400)
  }
  try {
    const server = await service.update(id, parsed.data)
    return c.json(server)
  } catch (err) {
    if (err instanceof Error && err.message === 'Server not found') {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Server not found' } }, 404)
    }
    throw err
  }
})

router.delete('/api/remote-servers/:id', async (c: Context) => {
  const id = c.req.param('id')!
  try {
    await service.delete(id)
    return c.json({ success: true })
  } catch (err) {
    if (err instanceof Error && err.message === 'Server not found') {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Server not found' } }, 404)
    }
    throw err
  }
})

router.post('/api/remote-servers/import-ssh-config', async (c: Context) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = ImportSshConfigSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400)
  }
  const result = await service.importSshConfig(parsed.data.configPath)
  return c.json(result)
})

router.post('/api/remote-servers/:id/test', async (c: Context) => {
  const id = c.req.param('id')!
  try {
    const result = await service.testConnection(id)
    return c.json(result)
  } catch (err) {
    if (err instanceof Error && err.message === 'Server not found') {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Server not found' } }, 404)
    }
    throw err
  }
})

export default router
