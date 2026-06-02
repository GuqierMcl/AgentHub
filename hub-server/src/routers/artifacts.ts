import { Hono, type Context } from 'hono'
import type { RunPersistenceService } from '../services/run-persistence.service'

declare module 'hono' {
  interface ContextVariableMap {
    runPersistenceService: RunPersistenceService
  }
}

const artifacts = new Hono()

artifacts.get('/api/conversations/:conversationId/artifacts/:artifactId', async (c: Context) => {
  const service = c.get('runPersistenceService')
  const conversationId = c.req.param('conversationId')!
  const artifactId = c.req.param('artifactId')!
  const result = await service.getArtifactDetail(conversationId, artifactId)
  return c.json(result)
})

export default artifacts
