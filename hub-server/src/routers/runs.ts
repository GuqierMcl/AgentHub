import { Hono, Context } from 'hono'
import type { RuntimeClient } from '../lib/runtime'
import type { Logger } from 'pino'
import { config } from '../config'
import {
  toProductHubRunEventEnvelope,
  type HubRunEventEnvelope,
  type RunPersistenceService,
} from '../services/run-persistence.service'
import { z } from 'zod'

declare module 'hono' {
  interface ContextVariableMap {
    runtimeClient: RuntimeClient
    runPersistenceService: RunPersistenceService
    logger: Logger
  }
}

const runs = new Hono()
const PermissionDecisionSchema = z.object({
  approved: z.boolean(),
  reason: z.string().trim().min(1).optional(),
}).strict()
const QuestionAnswerSchema = z.object({
  questionId: z.string().trim().min(1),
  optionId: z.string().trim().min(1).optional(),
  answer: z.string().trim().min(1).optional(),
  custom: z.boolean().optional(),
}).strict()
const QuestionAnswerRequestSchema = z.object({
  answers: z.array(QuestionAnswerSchema).min(1),
}).strict()
const SSE_KEEPALIVE_INTERVAL_MS = 5_000

export function encodeHubRunEvent(envelope: HubRunEventEnvelope): Uint8Array {
  const payload = `event: run.event\ndata: ${JSON.stringify(toProductHubRunEventEnvelope(envelope))}\n\n`
  return new TextEncoder().encode(payload)
}

function encodeSseComment(comment: string): Uint8Array {
  return new TextEncoder().encode(`: ${comment}\n\n`)
}

runs.get('/api/runs/:runId/events', async (c: Context) => {
  const service = c.get('runPersistenceService')
  const runId = c.req.param('runId')!
  const afterSequence = Number.parseInt(c.req.query('afterSequence') ?? '0', 10)
  const replayAfter = Number.isFinite(afterSequence) ? afterSequence : 0
  await service.getRunStatus(runId)

  let unsubscribe: (() => void) | undefined
  let keepAliveTimer: ReturnType<typeof setInterval> | undefined
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      let replaying = true
      const seenSequences = new Set<number>()
      const liveBuffer: HubRunEventEnvelope[] = []
      const close = () => {
        if (closed) return
        closed = true
        unsubscribe?.()
        if (keepAliveTimer) {
          clearInterval(keepAliveTimer)
          keepAliveTimer = undefined
        }
        controller.close()
      }
      const sendKeepAlive = () => {
        if (closed) return
        controller.enqueue(encodeSseComment('keepalive'))
      }
      const send = (envelope: HubRunEventEnvelope) => {
        if (closed) return
        if (seenSequences.has(envelope.sequence)) return
        seenSequences.add(envelope.sequence)
        controller.enqueue(encodeHubRunEvent(envelope))
        if (service.isTerminalRunStatus(envelope.event.type.replace('run.', ''))) {
          close()
        }
      }

      sendKeepAlive()
      keepAliveTimer = setInterval(sendKeepAlive, SSE_KEEPALIVE_INTERVAL_MS)

      unsubscribe = service.subscribe(runId, (envelope: HubRunEventEnvelope) => {
        if (replaying) {
          liveBuffer.push(envelope)
          return
        }
        send(envelope)
      })

      const replayEvents = await service.listRunEventsAfter(runId, replayAfter)
      for (const envelope of replayEvents) {
        send(envelope)
      }
      replaying = false

      liveBuffer
        .sort((a, b) => a.sequence - b.sequence)
        .forEach(send)

      const status = await service.getRunStatus(runId)
      if (closed || service.isTerminalRunStatus(status)) {
        close()
        return
      }
    },
    cancel() {
      unsubscribe?.()
      if (keepAliveTimer) {
        clearInterval(keepAliveTimer)
        keepAliveTimer = undefined
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})

runs.post('/api/runs/:runId/cancel', async (c: Context) => {
  const service = c.get('runPersistenceService')
  const runId = c.req.param('runId')!
  const result = await service.cancelRun(runId)
  return c.json(result)
})

runs.post('/api/runs/:runId/permissions/:requestId/decision', async (c: Context) => {
  const service = c.get('runPersistenceService')
  const runId = c.req.param('runId')!
  const requestId = c.req.param('requestId')!
  const body = await c.req.json().catch(() => null)
  const parsed = PermissionDecisionSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({
      error: {
        code: 'PERMISSION_INVALID_INPUT',
        message: 'Invalid permission decision input',
        details: parsed.error.issues,
      },
    }, 400)
  }

  const result = await service.decidePermission(
    runId,
    requestId,
    parsed.data.approved,
    parsed.data.reason,
  )
  return c.json(result)
})

runs.post('/api/runs/:runId/questions/:requestId/answer', async (c: Context) => {
  const service = c.get('runPersistenceService')
  const runId = c.req.param('runId')!
  const requestId = c.req.param('requestId')!
  const body = await c.req.json().catch(() => null)
  const parsed = QuestionAnswerRequestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({
      error: {
        code: 'QUESTION_INVALID_INPUT',
        message: 'Invalid question answer input',
        details: parsed.error.issues,
      },
    }, 400)
  }

  const result = await service.answerQuestion(
    runId,
    requestId,
    parsed.data.answers,
  )
  return c.json(result)
})

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

runs.post('/api/runtime/runs/:runId/questions/:requestId/answer', async (c: Context) => {
  const client = c.get('runtimeClient')
  const runId = c.req.param('runId')!
  const requestId = c.req.param('requestId')!
  const body = await c.req.json()
  const { data, status } = await client.forward('POST', `/runtime/runs/${encodeURIComponent(runId)}/questions/${encodeURIComponent(requestId)}/answer`, body, { raw: true })
  return c.json(data, status as 200)
})

runs.post('/api/runtime/runs/:runId/cancel', async (c: Context) => {
  const client = c.get('runtimeClient')
  const runId = c.req.param('runId')!
  const { data, status } = await client.forward('POST', `/runtime/runs/${encodeURIComponent(runId)}/cancel`, undefined, { raw: true })
  return c.json(data, status as 200)
})

export default runs
