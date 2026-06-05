import { Hono, type Context } from 'hono'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { RuntimeClient } from '../lib/runtime'
import { config } from '../config'
import {
  InstructLastPromptService,
  type InstructLastPromptSnapshot,
} from '../services/instruct-last-prompt.service'

declare module 'hono' {
  interface ContextVariableMap {
    runtimeClient: RuntimeClient
  }
}

type InstructPromptServiceLike = {
  get: () => InstructLastPromptSnapshot
  save: (prompt: string) => InstructLastPromptSnapshot
}

const defaultPromptService = new InstructLastPromptService(
  resolve(config.dataDir, 'instruct-agent-create.json')
)

const InstructRunCreateSchema = z.object({
  conversationId: z.string().trim().min(1),
  userMessage: z.object({
    role: z.literal('user'),
    content: z.string().trim().min(1),
  }).strict(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  }).strict()).optional(),
  draft: z.record(z.string(), z.unknown()).optional(),
  diagnostics: z.record(z.string(), z.unknown()).optional(),
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

export function createInstructRunsRouter(options?: {
  promptService?: InstructPromptServiceLike
}): Hono {
  const promptService = options?.promptService ?? defaultPromptService
  const instructRuns = new Hono()

  instructRuns.get('/api/instruct-runs/last-prompt', (c: Context) => {
    return c.json(promptService.get())
  })

  instructRuns.post('/api/instruct-runs', async (c: Context) => {
    const client = c.get('runtimeClient')
    const body = await c.req.json().catch(() => null)
    const parsed = InstructRunCreateSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({
        error: {
          code: 'INSTRUCT_RUN_INVALID_INPUT',
          message: 'Invalid instruct run input',
          details: parsed.error.issues,
        },
      }, 400)
    }

    const normalizedContent = parsed.data.userMessage.content.trim()
    if (normalizedContent.length > 0) {
      promptService.save(normalizedContent)
    }

    const { data, status } = await client.forward(
      'POST',
      '/runtime/instruct-runs',
      body,
      { raw: true },
    )
    return c.json(data, status as 200)
  })

  instructRuns.get('/api/instruct-runs/:runId', async (c: Context) => {
    const client = c.get('runtimeClient')
    const runId = c.req.param('runId')!
    const { data, status } = await client.forward(
      'GET',
      `/runtime/instruct-runs/${encodeURIComponent(runId)}`,
      undefined,
      { raw: true },
    )
    return c.json(data, status as 200)
  })

  instructRuns.get('/api/instruct-runs/:runId/events', async (c: Context) => {
    const client = c.get('runtimeClient')
    const runId = c.req.param('runId')!
    const response = await client.stream(
      `/runtime/instruct-runs/${encodeURIComponent(runId)}/events`,
    )

    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  })

  instructRuns.post('/api/instruct-runs/:runId/questions/:requestId/answer', async (c: Context) => {
    const client = c.get('runtimeClient')
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

    const { data, status } = await client.forward(
      'POST',
      `/runtime/instruct-runs/${encodeURIComponent(runId)}/questions/${encodeURIComponent(requestId)}/answer`,
      parsed.data,
      { raw: true },
    )
    return c.json(data, status as 200)
  })

  instructRuns.post('/api/instruct-runs/:runId/cancel', async (c: Context) => {
    const client = c.get('runtimeClient')
    const runId = c.req.param('runId')!
    const { data, status } = await client.forward(
      'POST',
      `/runtime/instruct-runs/${encodeURIComponent(runId)}/cancel`,
      undefined,
      { raw: true },
    )
    return c.json(data, status as 200)
  })

  return instructRuns
}

export default createInstructRunsRouter()
