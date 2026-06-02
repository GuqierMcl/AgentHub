import { describe, expect, it } from 'bun:test'
import { Hono, type Context, type Next } from 'hono'
import artifactsRouter from './artifacts'
import { errorHandler, notFound } from '../lib/errors'
import type { RunPersistenceService } from '../services/run-persistence.service'

function createApp(service: Partial<RunPersistenceService>): Hono {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c: Context, next: Next) => {
    c.set('runPersistenceService', service as RunPersistenceService)
    await next()
  })
  app.route('/', artifactsRouter)
  return app
}

describe('artifacts router', () => {
  it('returns conversation-scoped artifact detail', async () => {
    const calls: unknown[] = []
    const app = createApp({
      getArtifactDetail: async (...args: unknown[]) => {
        calls.push(args)
        return {
          artifact: {
            id: 'art_1',
            conversationId: 'conv_1',
            runId: 'run_1',
            messageId: 'msg_1',
            createdByAgentId: 'coder',
            type: 'diff',
            title: 'Workspace changes',
            status: 'ready',
            currentVersionId: 'ver_1',
            metadataJson: {},
            createdAt: '2026-06-02T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
            currentVersion: null,
          },
          currentVersion: {
            id: 'ver_1',
            artifactId: 'art_1',
            version: 1,
            source: 'agent',
            language: 'diff',
            content: 'diff --git a/a.ts b/a.ts\n',
            summary: '1 file changed',
            diffJson: { status: 'available' },
            createdByAgentId: 'coder',
            createdAt: '2026-06-02T00:00:00.000Z',
          },
          diff: {
            summary: { status: 'available' },
            changedFiles: [{
              path: 'a.ts',
              status: 'M',
              additions: 1,
              deletions: 0,
            }],
            patchText: 'diff --git a/a.ts b/a.ts\n',
            patchTruncated: false,
            baselineDirty: false,
            runOnlyReliable: true,
            limitations: [],
          },
        }
      },
    })

    const response = await app.request('/api/conversations/conv_1/artifacts/art_1')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      artifact: { id: 'art_1', conversationId: 'conv_1', type: 'diff' },
      currentVersion: { id: 'ver_1', artifactId: 'art_1' },
      diff: {
        changedFiles: [{ path: 'a.ts', status: 'M' }],
        patchTruncated: false,
      },
    })
    expect(calls).toEqual([['conv_1', 'art_1']])
  })

  it('returns a stable not found error for missing or cross-conversation artifacts', async () => {
    const app = createApp({
      getArtifactDetail: async () => {
        throw notFound('ARTIFACT_NOT_FOUND', '产物不存在')
      },
    })

    const response = await app.request('/api/conversations/conv_1/artifacts/art_missing')
    const body = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(404)
    expect(body.error?.code).toBe('ARTIFACT_NOT_FOUND')
  })
})
