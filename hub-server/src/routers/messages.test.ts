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
import type {
  ConversationHistoryPageResponse,
  ConversationSendAckResponse,
  RunPersistenceService,
} from '../services/run-persistence.service'
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

function createSendAckResponse(
  overrides?: Partial<ConversationSendAckResponse>,
): ConversationSendAckResponse {
  return {
    conversationId: 'conv_1',
    triggerMessage: {
      id: 'msg_send',
      conversationId: 'conv_1',
      runId: 'run_send',
      runtimeMessageId: null,
      runtimeRunId: null,
      messageIndex: null,
      surface: 'chat',
      role: 'user',
      senderType: 'user',
      senderId: 'user',
      agentId: null,
      taskId: null,
      groupId: null,
      parentMessageId: null,
      regeneratedFromId: null,
      status: 'completed',
      finishReason: null,
      firstEventSequence: 0,
      lastEventSequence: 0,
      metadataJson: {},
      uiMessageJson: null,
      createdAt: '2026-06-09T00:00:00.000Z',
      updatedAt: '2026-06-09T00:00:00.000Z',
      completedAt: '2026-06-09T00:00:00.000Z',
      parts: [],
    },
    activeRun: {
      id: 'run_send',
      runtimeId: 'runtime_send',
      status: 'queued',
      lastEventSequence: 0,
      plan: null,
    },
    ...overrides,
  }
}

function createHistoryResponse(
  overrides?: Partial<ConversationHistoryPageResponse>,
): ConversationHistoryPageResponse {
  return {
    messages: [],
    timelineRuns: [],
    page: {
      limit: 20,
      hasOlder: false,
      nextCursor: null,
    },
    ...overrides,
  }
}

describe('messages router', () => {
  it('forwards addressed agent ids to RunPersistenceService', async () => {
    const calls: unknown[] = []
    const app = createApp({
      sendMessage: async (...args: unknown[]) => {
        calls.push(args)
        return createSendAckResponse()
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
        return createSendAckResponse()
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
        return createSendAckResponse()
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

  it('forwards image attachments and accepts image-only requests', async () => {
    const calls: unknown[] = []
    const app = createApp({
      sendMessage: async (...args: unknown[]) => {
        calls.push(args)
        return createSendAckResponse()
      },
    })

    const response = await app.request('/api/conversations/conv_1/messages/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attachments: [
          { kind: 'image', assetId: 'asset_image_1' },
        ],
      }),
    })

    expect(response.status).toBe(201)
    expect(calls).toEqual([[
      'conv_1',
      '',
      {
        addressedAgentIds: [],
        attachments: [
          { kind: 'image', assetId: 'asset_image_1' },
        ],
      },
    ]])
  })

  it('rejects empty text when no attachments are provided', async () => {
    const calls: unknown[] = []
    const app = createApp({
      sendMessage: async (...args: unknown[]) => {
        calls.push(args)
        return createSendAckResponse()
      },
    })

    const response = await app.request('/api/conversations/conv_1/messages/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '   ' }),
    })
    const body = await response.json() as { error: { code: string } }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(calls).toEqual([])
  })

  it('forwards regenerate requests to RunPersistenceService', async () => {
    const calls: unknown[] = []
    const app = createApp({
      regenerateAssistantMessage: async (...args: unknown[]) => {
        calls.push(args)
        return createSendAckResponse()
      },
    })

    const response = await app.request('/api/conversations/conv_1/messages/msg_assistant/regenerate', {
      method: 'POST',
    })

    expect(response.status).toBe(201)
    expect(calls).toEqual([['conv_1', 'msg_assistant']])
  })

  it('forwards history pagination params to RunPersistenceService', async () => {
    const calls: unknown[] = []
    const app = createApp({
      listConversationHistoryPage: async (...args: unknown[]) => {
        calls.push(args)
        return createHistoryResponse({
          page: {
            limit: 10,
            hasOlder: true,
            nextCursor: 'run:run_older',
          },
        })
      },
    })

    const response = await app.request('/api/conversations/conv_1/messages/history?cursor=run%3Arun_latest&limit=10')
    const body = await response.json() as ConversationHistoryPageResponse

    expect(response.status).toBe(200)
    expect(body.page).toEqual({
      limit: 10,
      hasOlder: true,
      nextCursor: 'run:run_older',
    })
    expect(calls).toEqual([[
      'conv_1',
      {
        cursor: 'run:run_latest',
        limit: 10,
      },
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
