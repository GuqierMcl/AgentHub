import { describe, expect, it } from 'bun:test'
import { Hono, type Context, type Next } from 'hono'
import messagesRouter from './messages'
import type { RunPersistenceService } from '../services/run-persistence.service'

function createApp(service: Partial<RunPersistenceService>): Hono {
  const app = new Hono()
  app.use('*', async (c: Context, next: Next) => {
    c.set('runPersistenceService', service as RunPersistenceService)
    await next()
  })
  app.route('/', messagesRouter)
  return app
}

describe('messages router', () => {
  it('forwards addressed agent ids to RunPersistenceService', async () => {
    const calls: unknown[] = []
    const app = createApp({
      sendMessage: async (...args: unknown[]) => {
        calls.push(args)
        return {
          messages: [],
          activeRun: null,
          latestPlan: null,
          runItems: {
            toolCalls: [],
            reasoningBlocks: [],
            taskGroups: [],
            tasks: [],
            plans: [],
            planTasks: [],
            permissionRequests: [],
          },
          timelineRuns: [],
        }
      },
    })

    const response = await app.request('/api/conversations/conv_1/messages/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: 'hello',
        addressedAgentIds: ['coder'],
      }),
    })

    expect(response.status).toBe(201)
    expect(calls).toEqual([[
      'conv_1',
      'hello',
      { addressedAgentIds: ['coder'] },
    ]])
  })

  it('defaults addressed agent ids to an empty list', async () => {
    const calls: unknown[] = []
    const app = createApp({
      sendMessage: async (...args: unknown[]) => {
        calls.push(args)
        return {
          messages: [],
          activeRun: null,
          latestPlan: null,
          runItems: {
            toolCalls: [],
            reasoningBlocks: [],
            taskGroups: [],
            tasks: [],
            plans: [],
            planTasks: [],
            permissionRequests: [],
          },
          timelineRuns: [],
        }
      },
    })

    const response = await app.request('/api/conversations/conv_1/messages/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    })

    expect(response.status).toBe(201)
    expect(calls).toEqual([[
      'conv_1',
      'hello',
      { addressedAgentIds: [] },
    ]])
  })
})
