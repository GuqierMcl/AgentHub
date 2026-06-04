import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono, type Context, type Next } from 'hono'
import messagesRouter from './messages'
import { closeDatabase, initDatabase } from '../lib/db'
import { createConversation } from '../repositories/conversation.repo'
import { createMessage } from '../repositories/message.repo'
import { createMessagePart } from '../repositories/message-part.repo'
import { createMessagePin } from '../repositories/message-pin.repo'
import type { RunPersistenceService } from '../services/run-persistence.service'
import { prepareTestDatabase } from '../test-utils/database'

let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'hub-server-messages-router-'))
  const dbPath = join(tempDir, 'hub.db').replace(/\\/g, '/')
  const dbUrl = `file:${dbPath}`
  prepareTestDatabase(dbUrl)
  await initDatabase(dbUrl)
})

afterAll(async () => {
  await closeDatabase()
  if (tempDir) {
    try {
      await rm(tempDir, { recursive: true, force: true })
    } catch {
      // SQLite can release WAL file handles slightly after disconnect on Windows.
    }
  }
})

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

  it('forwards reply target ids to RunPersistenceService', async () => {
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
        content: 'follow up',
        replyToMessageId: 'msg_parent',
      }),
    })

    expect(response.status).toBe(201)
    expect(calls).toEqual([[
      'conv_1',
      'follow up',
      {
        addressedAgentIds: [],
        replyToMessageId: 'msg_parent',
      },
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

  it('returns pinned message content for the conversation pin list', async () => {
    const app = createApp({})
    const conversation = await createConversation({
      title: 'Pinned list',
      mode: 'single',
    })
    const message = await createMessage({
      conversationId: conversation.id,
      surface: 'chat',
      role: 'user',
      senderType: 'user',
      senderId: 'user',
      status: 'completed',
      completedAt: '2026-06-04T08:00:00.000Z',
    })
    await createMessagePart({
      messageId: message.id,
      conversationId: conversation.id,
      partKey: 'text',
      partIndex: 0,
      type: 'text',
      state: 'done',
      text: '这是需要在置顶栏里完整辨认的消息内容。',
    })
    await createMessagePin({
      conversationId: conversation.id,
      messageId: message.id,
      sortOrder: 0,
    })

    const response = await app.request(`/api/conversations/${conversation.id}/pins`)
    const body = await response.json() as {
      pins: Array<{
        messageId: string
        messageContent?: string | null
      }>
    }

    expect(response.status).toBe(200)
    expect(body.pins).toHaveLength(1)
    expect(body.pins[0]).toMatchObject({
      messageId: message.id,
      messageContent: '这是需要在置顶栏里完整辨认的消息内容。',
    })
  })
})
