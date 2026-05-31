import { describe, expect, it } from 'bun:test'
import { Hono, type Context, type Next } from 'hono'
import runsRouter, { encodeHubRunEvent } from './runs'
import type { RunPersistenceService } from '../services/run-persistence.service'

function createApp(service: Partial<RunPersistenceService>): Hono {
  const app = new Hono()
  app.use('*', async (c: Context, next: Next) => {
    c.set('runPersistenceService', service as RunPersistenceService)
    await next()
  })
  app.route('/', runsRouter)
  return app
}

describe('runs router', () => {
  it('forwards product permission decisions through RunPersistenceService', async () => {
    const calls: unknown[] = []
    const app = createApp({
      decidePermission: async (...args: unknown[]) => {
        calls.push(args)
        return {
          requestId: 'permission_1',
          status: 'approved',
        }
      },
    })

    const response = await app.request('/api/runs/run_1/permissions/permission_1/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved: true, reason: 'Allowed' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      requestId: 'permission_1',
      status: 'approved',
    })
    expect(calls).toEqual([['run_1', 'permission_1', true, 'Allowed']])
  })

  it('validates product permission decision input', async () => {
    const app = createApp({})

    const response = await app.request('/api/runs/run_1/permissions/permission_1/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Missing approved flag' }),
    })
    const body = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(400)
    expect(body.error?.code).toBe('PERMISSION_INVALID_INPUT')
  })

  it('forwards product question answers through RunPersistenceService', async () => {
    const calls: unknown[] = []
    const app = createApp({
      answerQuestion: async (...args: unknown[]) => {
        calls.push(args)
        return {
          requestId: 'question_1',
          status: 'answered',
        }
      },
    })

    const response = await app.request('/api/runs/run_1/questions/question_1/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answers: [{
          questionId: 'question_1',
          optionId: 'option_1',
        }],
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      requestId: 'question_1',
      status: 'answered',
    })
    expect(calls).toEqual([[
      'run_1',
      'question_1',
      [{
        questionId: 'question_1',
        optionId: 'option_1',
      }],
    ]])
  })

  it('validates product question answer input', async () => {
    const app = createApp({})

    const response = await app.request('/api/runs/run_1/questions/question_1/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: [] }),
    })
    const body = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(400)
    expect(body.error?.code).toBe('QUESTION_INVALID_INPUT')
  })

  it('omits web_fetch response bodies in product run SSE envelopes', () => {
    const body = 'x'.repeat(20_000)
    const envelope = {
      sequence: 1,
      event: {
        id: 'event_1',
        runId: 'runtime_run_1',
        type: 'tool.completed',
        timestamp: '2026-05-30T00:00:00.000Z',
        toolCallId: 'call_1',
        toolName: 'web_fetch',
        data: {
          status: 'completed',
          data: {
            statusCode: 200,
            headers: {
              'content-type': 'text/plain',
            },
            body,
          },
        },
      },
    }

    const encoded = new TextDecoder().decode(encodeHubRunEvent(envelope))
    const dataLine = encoded
      .split('\n')
      .find((line) => line.startsWith('data: '))
    const payload = JSON.parse(dataLine?.slice('data: '.length) ?? '{}')
    const output = payload.event.data.data

    expect(output.body).toBeUndefined()
    expect(output.headers).toBeUndefined()
    expect(output.headerCount).toBe(1)
    expect(output.bodyCharacters).toBe(20_000)
    expect(output.bodyOmittedForUi).toBe(true)
    expect(envelope.event.data.data.body).toHaveLength(20_000)
  })
})
