import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { config } from '../config'
import { closeDatabase, initDatabase } from '../lib/db'
import { prepareTestDatabase } from '../test-utils/database'
import { createConversationAgent } from '../repositories/conversation-agent.repo'
import { createConversation } from '../repositories/conversation.repo'
import { createMessage, findMessageByRunAndRuntimeMessageId, listMessagesWithParts } from '../repositories/message.repo'
import { createMessagePart } from '../repositories/message-part.repo'
import { createMessagePin } from '../repositories/message-pin.repo'
import { createRun } from '../repositories/run.repo'
import { createArtifact, listArtifacts, updateArtifact } from '../repositories/artifact.repo'
import { createArtifactVersion, listArtifactVersionsByArtifact } from '../repositories/artifact-version.repo'
import { listPermissionRequests } from '../repositories/permission-request.repo'
import {
  type ExternalAgentSessionOutput,
  findExternalAgentSessionHint,
  upsertExternalAgentSession,
} from '../repositories/external-agent-session.repo'
import {
  buildExternalContextPacket,
  buildOpenCodeExternalContextPacket,
  RuntimeEventBatcher,
  RunPersistenceService,
  isPersistedTerminalRuntimeEvent,
  isRetryableRuntimeEventStreamError,
  resolveAddressedAgentIds,
  toProductHubRunEventEnvelope,
} from './run-persistence.service'
import {
  CONVERSATION_IMAGE_MAX_PER_MESSAGE,
  saveConversationImageAsset,
  type ConversationImageAssetMetadata,
} from './conversation-image-assets.service'

let tempDir: string
const originalDataDir = config.dataDir

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'hub-server-run-persistence-'))
  config.dataDir = tempDir
  const dbPath = join(tempDir, 'hub.db').replace(/\\/g, '/')
  const dbUrl = `file:${dbPath}`
  prepareTestDatabase(dbUrl)
  await initDatabase(dbUrl)
})

afterAll(async () => {
  await closeDatabase()
  config.dataDir = originalDataDir
  if (tempDir) {
    try {
      await rm(tempDir, { recursive: true, force: true })
    } catch {
      // SQLite can release WAL file handles slightly after disconnect on Windows.
    }
  }
})

describe('RuntimeEventBatcher', () => {
  it('flushes items in arrival order when max batch size is reached', async () => {
    const flushed: number[][] = []
    const batcher = new RuntimeEventBatcher<number>({
      flushIntervalMs: 10_000,
      maxBatchSize: 3,
      maxBufferedItems: 10,
      flush: async (items) => {
        flushed.push(items)
      },
    })

    await batcher.enqueue(1)
    await batcher.enqueue(2)
    await batcher.enqueue(3)
    await batcher.close()

    expect(flushed).toEqual([[1, 2, 3]])
  })

  it('flushes immediately when forceFlush is requested', async () => {
    const flushed: string[][] = []
    const batcher = new RuntimeEventBatcher<string>({
      flushIntervalMs: 10_000,
      maxBatchSize: 10,
      maxBufferedItems: 10,
      flush: async (items) => {
        flushed.push(items)
      },
    })

    await batcher.enqueue('run.started')
    await batcher.enqueue('run.completed', { forceFlush: true })

    expect(flushed).toEqual([['run.started', 'run.completed']])
  })

  it('propagates flush failures to later operations', async () => {
    const batcher = new RuntimeEventBatcher<number>({
      flushIntervalMs: 10_000,
      maxBatchSize: 1,
      maxBufferedItems: 10,
      flush: async () => {
        throw new Error('write failed')
      },
    })

    await expect(batcher.enqueue(1)).rejects.toThrow('write failed')
    await expect(batcher.enqueue(2)).rejects.toThrow('write failed')
  })
})

describe('buildOpenCodeExternalContextPacket', () => {
  function messageRecord(input: {
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    surface?: string
    status?: string
    agentId?: string | null
    senderType?: string
    senderId?: string | null
    parentMessageId?: string | null
    metadataJson?: Record<string, unknown>
    createdAt?: string
  }) {
    return {
      id: input.id,
      conversationId: 'conv_context',
      runId: null,
      runtimeMessageId: null,
      runtimeRunId: null,
      messageIndex: null,
      surface: input.surface ?? 'chat',
      role: input.role,
      senderType: input.senderType ?? (input.role === 'user' ? 'user' : 'agent'),
      senderId: input.senderId ?? (input.role === 'user' ? 'user' : input.agentId ?? null),
      agentId: input.agentId ?? null,
      taskId: null,
      groupId: null,
      parentMessageId: input.parentMessageId ?? null,
      regeneratedFromId: null,
      status: input.status ?? 'completed',
      finishReason: null,
      firstEventSequence: null,
      lastEventSequence: null,
      metadataJson: JSON.stringify(input.metadataJson ?? {}),
      uiMessageJson: null,
      createdAt: input.createdAt ?? '2026-06-02T00:00:00.000Z',
      updatedAt: input.createdAt ?? '2026-06-02T00:00:00.000Z',
      completedAt: input.createdAt ?? '2026-06-02T00:00:00.000Z',
      parts: [{
        id: `${input.id}_part`,
        messageId: input.id,
        conversationId: 'conv_context',
        runId: null,
        runtimeEventId: null,
        partKey: 'text',
        partIndex: 0,
        entityType: null,
        entityId: null,
        type: 'text',
        state: 'done',
        text: input.content,
        payloadJson: '{}',
        firstEventSequence: null,
        lastEventSequence: null,
        createdAt: input.createdAt ?? '2026-06-02T00:00:00.000Z',
        updatedAt: input.createdAt ?? '2026-06-02T00:00:00.000Z',
      }],
    }
  }

  function delegatedSession(input: {
    id: string
    providerSessionId: string
    summary: string
    updatedAt: string
    taskId?: string
  }): ExternalAgentSessionOutput {
    return {
      id: input.id,
      provider: 'opencode',
      agentId: 'opencode',
      conversationId: 'conv_context',
      workspaceIdentity: 'workspace_context',
      scope: 'delegated-task',
      providerSessionId: input.providerSessionId,
      parentProviderSessionId: null,
      runId: 'run_delegated',
      taskId: input.taskId ?? null,
      status: 'active',
      handoffSummary: input.summary,
      lastSyncedRunEventId: null,
      metadataJson: {},
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt,
    }
  }

  it('creates bootstrap context from visible completed chat messages only', () => {
    const packet = buildOpenCodeExternalContextPacket({
      agentId: 'opencode',
      historyMessages: [
        messageRecord({ id: 'msg_user', role: 'user', content: 'Visible user request.' }),
        messageRecord({ id: 'msg_hidden', role: 'assistant', agentId: 'coder', content: 'Hidden note.', surface: 'hidden' }),
        messageRecord({ id: 'msg_streaming', role: 'assistant', agentId: 'coder', content: 'Still streaming.', status: 'streaming' }),
        messageRecord({ id: 'msg_coder', role: 'assistant', agentId: 'coder', content: 'Visible coder reply.' }),
      ],
      delegatedSessions: [],
    })

    expect(packet?.mode).toBe('bootstrap')
    expect(packet?.messages.map((message) => message.id)).toEqual(['msg_user', 'msg_coder'])
    expect(packet?.messages.map((message) => message.content)).toEqual([
      'Visible user request.',
      'Visible coder reply.',
    ])
    expect(packet?.cursorCandidate?.includedMessageIds).toEqual(['msg_user', 'msg_coder'])
  })

  it('builds a Claude Code context packet with the provider preserved', () => {
    const packet = buildExternalContextPacket({
      provider: 'claude-code',
      agentId: 'claude-code',
      historyMessages: [
        messageRecord({ id: 'msg_claude_user', role: 'user', content: 'Pick up the prior plan.' }),
      ],
      delegatedSessions: [
        {
          ...delegatedSession({
            id: 'eas_claude_task',
            providerSessionId: 'claude_task_session',
            summary: 'Claude Code inspected the runtime adapter tests.',
            updatedAt: '2026-06-05T00:01:00.000Z',
            taskId: 'task_claude',
          }),
          provider: 'claude-code',
          agentId: 'claude-code',
        },
      ],
    })

    expect(packet).toMatchObject({
      provider: 'claude-code',
      agentId: 'claude-code',
      scope: 'conversation-visible',
      mode: 'bootstrap',
    })
    expect(packet?.messages.map((message) => message.id)).toEqual(['msg_claude_user'])
    expect(packet?.handoffSummaries.map((summary) => summary.providerSessionId)).toEqual(['claude_task_session'])
  })

  it('builds a Codex context packet with the provider preserved', () => {
    const packet = buildExternalContextPacket({
      provider: 'codex',
      agentId: 'codex',
      historyMessages: [
        messageRecord({ id: 'msg_codex_user', role: 'user', content: 'Continue the SDK adapter.' }),
      ],
      delegatedSessions: [
        {
          ...delegatedSession({
            id: 'eas_codex_task',
            providerSessionId: 'codex_task_thread',
            summary: 'Codex inspected the SDK client interface.',
            updatedAt: '2026-06-06T00:01:00.000Z',
            taskId: 'task_codex',
          }),
          provider: 'codex',
          agentId: 'codex',
        },
      ],
    })

    expect(packet).toMatchObject({
      provider: 'codex',
      agentId: 'codex',
      scope: 'conversation-visible',
      mode: 'bootstrap',
    })
    expect(packet?.messages.map((message) => message.id)).toEqual(['msg_codex_user'])
    expect(packet?.handoffSummaries.map((summary) => summary.providerSessionId)).toEqual(['codex_task_thread'])
  })

  it('uses delta cursor and includes only newer delegated handoffs', () => {
    const packet = buildOpenCodeExternalContextPacket({
      agentId: 'opencode',
      sessionMetadata: {
        contextBridge: {
          lastSyncedMessageId: 'msg_old',
          lastSyncedAt: '2026-06-02T00:02:00.000Z',
        },
      },
      historyMessages: [
        messageRecord({ id: 'msg_old', role: 'user', content: 'Already synced.', createdAt: '2026-06-02T00:01:00.000Z' }),
        messageRecord({ id: 'msg_new_user', role: 'user', content: 'New user context.', createdAt: '2026-06-02T00:03:00.000Z' }),
        messageRecord({ id: 'msg_new_agent', role: 'assistant', agentId: 'coder', content: 'New agent context.', createdAt: '2026-06-02T00:04:00.000Z' }),
      ],
      delegatedSessions: [
        delegatedSession({
          id: 'eas_old',
          providerSessionId: 'ses_old',
          summary: 'Old handoff.',
          updatedAt: '2026-06-02T00:01:30.000Z',
        }),
        delegatedSession({
          id: 'eas_new',
          providerSessionId: 'ses_new',
          summary: 'New handoff.',
          updatedAt: '2026-06-02T00:03:30.000Z',
          taskId: 'task_new',
        }),
      ],
    })

    expect(packet?.mode).toBe('delta')
    expect(packet?.messages.map((message) => message.id)).toEqual(['msg_new_user', 'msg_new_agent'])
    expect(packet?.handoffSummaries.map((summary) => summary.sessionId)).toEqual(['eas_new'])
    expect(packet?.handoffSummaries[0]?.summary).toBe('New handoff.')
    expect(packet?.cursorCandidate?.throughMessageId).toBe('msg_new_agent')
    expect(packet?.cursorCandidate?.includedHandoffSessionIds).toEqual(['eas_new'])
  })

  it('keeps reply context in delta messages even when the parent message is not included', () => {
    const packet = buildOpenCodeExternalContextPacket({
      agentId: 'opencode',
      sessionMetadata: {
        contextBridge: {
          lastSyncedMessageId: 'msg_parent',
          lastSyncedAt: '2026-06-02T00:02:00.000Z',
        },
      },
      historyMessages: [
        messageRecord({
          id: 'msg_parent',
          role: 'assistant',
          agentId: 'coder',
          content: 'The original answer that is already synced.',
          createdAt: '2026-06-02T00:01:00.000Z',
        }),
        messageRecord({
          id: 'msg_reply',
          role: 'user',
          content: 'Can you expand that part?',
          parentMessageId: 'msg_parent',
          createdAt: '2026-06-02T00:03:00.000Z',
          metadataJson: {
            replyTo: {
              messageId: 'msg_parent',
              role: 'assistant',
              senderType: 'agent',
              senderId: 'coder',
              agentId: 'coder',
              createdAt: '2026-06-02T00:01:00.000Z',
              excerpt: 'The original answer that is already synced.',
            },
          },
        }),
      ],
      delegatedSessions: [],
    })

    expect(packet?.mode).toBe('delta')
    expect(packet?.messages.map((message) => message.id)).toEqual(['msg_reply'])
    expect(packet?.messages[0]?.content).toContain('[Replying to assistant coder (msg_parent)]')
    expect(packet?.messages[0]?.content).toContain('> The original answer that is already synced.')
    expect(packet?.messages[0]?.content).toContain('Can you expand that part?')
  })

  it('keeps regenerate context in delta messages for external agents', () => {
    const packet = buildOpenCodeExternalContextPacket({
      agentId: 'opencode',
      sessionMetadata: {
        contextBridge: {
          lastSyncedMessageId: 'msg_source_assistant',
          lastSyncedAt: '2026-06-05T00:02:00.000Z',
        },
      },
      historyMessages: [
        messageRecord({
          id: 'msg_source_assistant',
          role: 'assistant',
          agentId: 'opencode',
          content: 'Original assistant answer.',
          createdAt: '2026-06-05T00:01:00.000Z',
        }),
        messageRecord({
          id: 'msg_regenerate_trigger',
          role: 'user',
          content: 'Original user request.',
          createdAt: '2026-06-05T00:03:00.000Z',
          metadataJson: {
            regenerate: {
              sourceAssistantMessageId: 'msg_source_assistant',
              sourceRunId: 'run_source',
              sourceTriggerMessageId: 'msg_source_trigger',
              sourceAssistantAgentId: 'opencode',
              sourceAssistantCreatedAt: '2026-06-05T00:01:00.000Z',
              sourceAssistantExcerpt: 'Original assistant answer.',
            },
          },
        }),
      ],
      delegatedSessions: [],
    })

    expect(packet?.mode).toBe('delta')
    expect(packet?.messages.map((message) => message.id)).toEqual(['msg_regenerate_trigger'])
    expect(packet?.messages[0]?.content).toContain('[Regenerating assistant message msg_source_assistant]')
    expect(packet?.messages[0]?.content).toContain('Please generate an alternative response')
    expect(packet?.messages[0]?.content).toContain('Original user request.')
  })
})

describe('external direct session bridge', () => {
  function createRuntimeCapture() {
    const calls: Array<{ method: string; path: string; body: any }> = []
    const runtimeClient = {
      forward: async (method: string, path: string, body: unknown) => {
        calls.push({ method, path, body })
        return {
          status: 201,
          data: {
            runId: `runtime_claude_direct_${randomUUID()}`,
            status: 'queued',
            eventsUrl: '/runtime/runs/runtime_claude_direct/events',
          },
        }
      },
    }
    const service = new RunPersistenceService(
      runtimeClient as never,
      { publish: () => {} } as never,
    )
    ;(service as any).startRuntimeConsumer = () => {}
    return { calls, service }
  }

  async function createClaudeCodeConversation() {
    const conversation = await createConversation({
      title: 'Claude Code direct chat',
      mode: 'single',
      metadataJson: {
        workspace: {
          workspaceId: 'workspace_claude_direct',
          backendType: 'local',
          rootPath: 'D:\\dev\\claude-direct',
        },
      },
    })
    await createConversationAgent({
      conversationId: conversation.id,
      agentId: 'claude-code',
      sortOrder: 0,
    })
    return conversation
  }

  async function createCodexConversation() {
    const conversation = await createConversation({
      title: 'Codex direct chat',
      mode: 'single',
      metadataJson: {
        workspace: {
          workspaceId: 'workspace_codex_direct',
          backendType: 'local',
          rootPath: 'D:\\dev\\codex-direct',
        },
      },
    })
    await createConversationAgent({
      conversationId: conversation.id,
      agentId: 'codex',
      sortOrder: 0,
    })
    return conversation
  }

  async function createTextMessage(input: {
    conversationId: string
    role: 'user' | 'assistant'
    text: string
    agentId?: string | null
  }) {
    const message = await createMessage({
      conversationId: input.conversationId,
      surface: 'chat',
      role: input.role,
      senderType: input.role === 'user' ? 'user' : 'agent',
      senderId: input.role === 'user' ? 'user' : input.agentId ?? null,
      agentId: input.agentId ?? null,
      status: 'completed',
      completedAt: '2026-06-05T08:00:00.000Z',
    })
    await createMessagePart({
      messageId: message.id,
      conversationId: input.conversationId,
      partKey: 'text',
      partIndex: 0,
      type: 'text',
      state: 'done',
      text: input.text,
    })
    return message
  }

  it('passes Claude Code direct session hints and context to runtime', async () => {
    const { calls, service } = createRuntimeCapture()
    const conversation = await createClaudeCodeConversation()
    const previousMessage = await createTextMessage({
      conversationId: conversation.id,
      role: 'assistant',
      agentId: 'claude-code',
      text: 'Previous Claude Code result.',
    })
    await upsertExternalAgentSession({
      provider: 'claude-code',
      agentId: 'claude-code',
      conversationId: conversation.id,
      workspaceIdentity: 'workspace_claude_direct',
      scope: 'conversation-visible',
      providerSessionId: 'claude_direct_session',
      runId: 'run_claude_previous',
      handoffSummary: 'Claude Code previously modified tests.',
      metadataJson: {
        contextBridge: {
          lastSyncedMessageId: previousMessage.id,
          lastSyncedAt: '2026-06-05T07:00:00.000Z',
        },
      },
    })
    const unsyncedMessage = await createTextMessage({
      conversationId: conversation.id,
      role: 'user',
      text: 'This already-visible message was not synced yet.',
    })

    await service.sendMessage(conversation.id, 'Continue with Claude Code.')

    const runtimeInput = calls[0]?.body
    expect(runtimeInput.externalSessionHints).toEqual([
      expect.objectContaining({
        provider: 'claude-code',
        agentId: 'claude-code',
        scope: 'conversation-visible',
        providerSessionId: 'claude_direct_session',
        workspaceId: 'workspace_claude_direct',
      }),
    ])
    expect(runtimeInput.externalContext).toEqual([
      expect.objectContaining({
        provider: 'claude-code',
        agentId: 'claude-code',
        mode: 'delta',
      }),
    ])
    expect(runtimeInput.externalContext[0].messages.map((message: any) => message.id)).toEqual([
      unsyncedMessage.id,
    ])
  })

  it('passes Codex direct session hints and context to runtime', async () => {
    const { calls, service } = createRuntimeCapture()
    const conversation = await createCodexConversation()
    const previousMessage = await createTextMessage({
      conversationId: conversation.id,
      role: 'assistant',
      agentId: 'codex',
      text: 'Previous Codex result.',
    })
    await upsertExternalAgentSession({
      provider: 'codex',
      agentId: 'codex',
      conversationId: conversation.id,
      workspaceIdentity: 'workspace_codex_direct',
      scope: 'conversation-visible',
      providerSessionId: 'codex_direct_thread',
      runId: 'run_codex_previous',
      handoffSummary: 'Codex previously modified adapter tests.',
      metadataJson: {
        contextBridge: {
          lastSyncedMessageId: previousMessage.id,
          lastSyncedAt: '2026-06-06T07:00:00.000Z',
        },
      },
    })
    const unsyncedMessage = await createTextMessage({
      conversationId: conversation.id,
      role: 'user',
      text: 'This Codex-visible message was not synced yet.',
    })

    await service.sendMessage(conversation.id, 'Continue with Codex.')

    const runtimeInput = calls[0]?.body
    expect(runtimeInput.externalSessionHints).toEqual([
      expect.objectContaining({
        provider: 'codex',
        agentId: 'codex',
        scope: 'conversation-visible',
        providerSessionId: 'codex_direct_thread',
        workspaceId: 'workspace_codex_direct',
      }),
    ])
    expect(runtimeInput.externalContext).toEqual([
      expect.objectContaining({
        provider: 'codex',
        agentId: 'codex',
        mode: 'delta',
      }),
    ])
    expect(runtimeInput.externalContext[0].messages.map((message: any) => message.id)).toEqual([
      unsyncedMessage.id,
    ])
  })

  it('updates Claude Code context bridge metadata from agent completion events', async () => {
    const { service } = createRuntimeCapture()
    const conversation = await createClaudeCodeConversation()
    const trigger = await createTextMessage({
      conversationId: conversation.id,
      role: 'user',
      text: 'Update context bridge.',
    })
    const run = await createRun({
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
      mode: 'single',
      status: 'running',
      runtimeId: 'runtime_claude_context',
      inputJson: {
        participantAgentIds: ['claude-code'],
        workspace: {
          workspaceId: 'workspace_claude_direct',
          backendType: 'local',
          rootPath: 'D:\\dev\\claude-direct',
        },
      },
    })
    await upsertExternalAgentSession({
      provider: 'claude-code',
      agentId: 'claude-code',
      conversationId: conversation.id,
      workspaceIdentity: 'workspace_claude_direct',
      scope: 'conversation-visible',
      providerSessionId: 'claude_context_session',
      runId: run.id,
    })

    await (service as any).projectRuntimeEventsBatch(run.id, [{
      sequence: 1,
      event: {
        id: `event_claude_agent_completed_${randomUUID()}`,
        runId: 'runtime_claude_context',
        type: 'agent.completed',
        timestamp: '2026-06-05T08:01:00.000Z',
        agentId: 'claude-code',
        data: {
          status: 'completed',
          externalSession: {
            provider: 'claude-code',
            agentId: 'claude-code',
            conversationId: conversation.id,
            workspaceId: 'workspace_claude_direct',
            scope: 'conversation-visible',
            providerSessionId: 'claude_context_session',
          },
          externalContext: {
            provider: 'claude-code',
            mode: 'delta',
            cursorCandidate: {
              includedMessageIds: [trigger.id],
              includedHandoffSessionIds: [],
            },
          },
        },
      },
    }])

    const session = await findExternalAgentSessionHint({
      provider: 'claude-code',
      agentId: 'claude-code',
      conversationId: conversation.id,
      workspaceIdentity: 'workspace_claude_direct',
      scope: 'conversation-visible',
      status: 'active',
    })
    expect(session?.metadataJson).toMatchObject({
      contextBridge: {
        mode: 'delta',
        lastSyncedMessageId: trigger.id,
        lastSyncedAt: expect.any(String),
        includedMessageIds: [trigger.id],
        includedHandoffSessionIds: [],
      },
    })
  })

  it('updates Codex context bridge metadata from agent completion events', async () => {
    const { service } = createRuntimeCapture()
    const conversation = await createCodexConversation()
    const trigger = await createTextMessage({
      conversationId: conversation.id,
      role: 'user',
      text: 'Update Codex context bridge.',
    })
    const run = await createRun({
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
      mode: 'single',
      status: 'running',
      runtimeId: 'runtime_codex_context',
      inputJson: {
        participantAgentIds: ['codex'],
        workspace: {
          workspaceId: 'workspace_codex_direct',
          backendType: 'local',
          rootPath: 'D:\\dev\\codex-direct',
        },
      },
    })
    await upsertExternalAgentSession({
      provider: 'codex',
      agentId: 'codex',
      conversationId: conversation.id,
      workspaceIdentity: 'workspace_codex_direct',
      scope: 'conversation-visible',
      providerSessionId: 'codex_context_thread',
      runId: run.id,
    })

    await (service as any).projectRuntimeEventsBatch(run.id, [{
      sequence: 1,
      event: {
        id: `event_codex_agent_completed_${randomUUID()}`,
        runId: 'runtime_codex_context',
        type: 'agent.completed',
        timestamp: '2026-06-06T08:01:00.000Z',
        agentId: 'codex',
        data: {
          status: 'completed',
          externalSession: {
            provider: 'codex',
            agentId: 'codex',
            conversationId: conversation.id,
            workspaceId: 'workspace_codex_direct',
            scope: 'conversation-visible',
            providerSessionId: 'codex_context_thread',
          },
          externalContext: {
            provider: 'codex',
            mode: 'delta',
            cursorCandidate: {
              includedMessageIds: [trigger.id],
              includedHandoffSessionIds: [],
            },
          },
        },
      },
    }])

    const session = await findExternalAgentSessionHint({
      provider: 'codex',
      agentId: 'codex',
      conversationId: conversation.id,
      workspaceIdentity: 'workspace_codex_direct',
      scope: 'conversation-visible',
      status: 'active',
    })
    expect(session?.metadataJson).toMatchObject({
      contextBridge: {
        mode: 'delta',
        lastSyncedMessageId: trigger.id,
        lastSyncedAt: expect.any(String),
        includedMessageIds: [trigger.id],
        includedHandoffSessionIds: [],
      },
    })
  })
})

describe('image message persistence and runtime input', () => {
  function createRuntimeCapture(runtimeStatus: 'queued' | 'completed' = 'completed') {
    const calls: Array<{ method: string; path: string; body: any }> = []
    const events: Array<{ type: string; payload: any }> = []
    const runtimeClient = {
      forward: async (method: string, path: string, body: unknown) => {
        calls.push({ method, path, body })
        return {
          status: 201,
          data: {
            runId: `runtime_image_${randomUUID()}`,
            status: runtimeStatus,
            eventsUrl: '/runtime/runs/runtime_image/events',
          },
        }
      },
    }
    const service = new RunPersistenceService(
      runtimeClient as never,
      {
        publish: (type: string, payload: unknown) => {
          events.push({ type, payload })
        },
      } as never,
    )
    ;(service as any).startRuntimeConsumer = () => {}
    return { calls, events, service }
  }

  async function createSingleAgentConversation(title: string, agentId = 'coder') {
    const conversation = await createConversation({
      title,
      mode: 'single',
      metadataJson: agentId === 'claude-code'
        ? {
            workspace: {
              workspaceId: 'workspace_image_context',
              backendType: 'local',
              rootPath: 'D:\\dev\\image-context',
            },
          }
        : undefined,
    })
    await createConversationAgent({
      conversationId: conversation.id,
      agentId,
      sortOrder: 0,
    })
    return conversation
  }

  async function createImageAsset(
    conversationId: string,
    fileName: string,
  ): Promise<{ metadata: ConversationImageAssetMetadata; bytes: Buffer }> {
    const bytes = await createPngBytes()
    const metadata = await saveConversationImageAsset({
      conversationId,
      fileName,
      mediaType: 'image/png',
      bytes,
    })
    return { metadata, bytes }
  }

  function toPublicImagePayload(metadata: ConversationImageAssetMetadata) {
    return {
      kind: metadata.kind,
      assetId: metadata.assetId,
      filename: metadata.filename,
      mediaType: metadata.mediaType,
      size: metadata.size,
      ...(typeof metadata.width === 'number' ? { width: metadata.width } : {}),
      ...(typeof metadata.height === 'number' ? { height: metadata.height } : {}),
      url: metadata.url,
    }
  }

  async function createImageOnlyMessage(input: {
    conversationId: string
    metadata: ConversationImageAssetMetadata
    role?: 'user' | 'assistant'
    runId?: string | null
    agentId?: string | null
    metadataJson?: Record<string, unknown>
  }) {
    const role = input.role ?? 'user'
    const message = await createMessage({
      conversationId: input.conversationId,
      runId: input.runId ?? null,
      surface: 'chat',
      role,
      senderType: role === 'user' ? 'user' : 'agent',
      senderId: role === 'user' ? 'user' : input.agentId ?? null,
      agentId: input.agentId ?? null,
      status: 'completed',
      metadataJson: input.metadataJson,
      completedAt: '2026-06-08T08:00:00.000Z',
    })
    await createMessagePart({
      messageId: message.id,
      conversationId: input.conversationId,
      runId: input.runId ?? undefined,
      partKey: `image:${input.metadata.assetId}`,
      partIndex: 0,
      type: 'image',
      state: 'done',
      payloadJson: toPublicImagePayload(input.metadata),
    })
    return message
  }

  async function createPngBytes(): Promise<Buffer> {
    return sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 32, g: 128, b: 220, alpha: 1 },
      },
    }).png().toBuffer()
  }

  it('persists an image-only message with no text part and sends a base64 image runtime part', async () => {
    const { calls, events, service } = createRuntimeCapture()
    const conversation = await createSingleAgentConversation('Image-only send')
    const image = await createImageAsset(conversation.id, 'image-only.png')

    const result = await service.sendMessage(conversation.id, '', {
      attachments: [
        { kind: 'image', assetId: image.metadata.assetId },
      ],
    })

    const userMessage = result.messages.find((message) =>
      message.role === 'user' &&
      message.parts.some((part) => part.partKey === `image:${image.metadata.assetId}`)
    )
    expect(userMessage).toBeTruthy()
    expect(userMessage?.parts.map((part) => part.type)).toEqual(['image'])
    expect(userMessage?.parts[0]).toMatchObject({
      partIndex: 0,
      partKey: `image:${image.metadata.assetId}`,
      type: 'image',
      text: null,
    })
    expect(userMessage?.parts[0]?.payloadJson).toEqual(toPublicImagePayload(image.metadata))

    expect(calls[0]?.body.userMessage).toMatchObject({
      id: userMessage?.id,
      role: 'user',
      content: '',
      parts: [
        {
          type: 'image',
          mediaType: 'image/png',
          filename: 'image-only.png',
          data: Buffer.from(image.bytes).toString('base64'),
          encoding: 'base64',
        },
      ],
    })
    expect(events.find((event) => event.type === 'conversation.last_message.updated')?.payload)
      .toMatchObject({ lastMessageContent: '[图片]' })
  })

  it('persists text before images and sends runtime parts in the same order', async () => {
    const { calls, service } = createRuntimeCapture()
    const conversation = await createSingleAgentConversation('Text and image send')
    const image = await createImageAsset(conversation.id, 'diagram.png')

    const result = await service.sendMessage(conversation.id, 'Describe this image.', {
      attachments: [
        { kind: 'image', assetId: image.metadata.assetId },
      ],
    })

    const userMessage = result.messages.find((message) =>
      message.role === 'user' &&
      message.parts.some((part) => part.partKey === `image:${image.metadata.assetId}`)
    )
    expect(userMessage?.parts.map((part) => [part.partIndex, part.type, part.partKey])).toEqual([
      [0, 'text', 'text'],
      [1, 'image', `image:${image.metadata.assetId}`],
    ])
    expect(userMessage?.parts[0]?.text).toBe('Describe this image.')
    expect(calls[0]?.body.userMessage.parts.map((part: { type: string }) => part.type)).toEqual([
      'text',
      'image',
    ])
    expect(calls[0]?.body.userMessage.parts[0]).toEqual({
      type: 'text',
      text: 'Describe this image.',
    })
  })

  it('includes image parts when replaying prior user messages into runtime history', async () => {
    const { calls, service } = createRuntimeCapture()
    const conversation = await createSingleAgentConversation('Image history')
    const image = await createImageAsset(conversation.id, 'history.png')

    const firstResult = await service.sendMessage(conversation.id, '', {
      attachments: [
        { kind: 'image', assetId: image.metadata.assetId },
      ],
    })
    const previousUserMessage = firstResult.messages.find((message) =>
      message.role === 'user' &&
      message.parts.some((part) => part.type === 'image')
    )

    await service.sendMessage(conversation.id, 'Use the previous image.')

    const historyMessage = calls[1]?.body.history.find((message: { id?: string }) =>
      message.id === previousUserMessage?.id
    )
    expect(historyMessage).toMatchObject({
      id: previousUserMessage?.id,
      role: 'user',
      content: '',
      parts: [
        {
          type: 'image',
          mediaType: 'image/png',
          filename: 'history.png',
          data: Buffer.from(image.bytes).toString('base64'),
          encoding: 'base64',
        },
      ],
    })
  })

  it('uses image fallback text for reply snapshots and reply runtime context', async () => {
    const { calls, service } = createRuntimeCapture()
    const conversation = await createSingleAgentConversation('Image reply')
    const image = await createImageAsset(conversation.id, 'reply-parent.png')
    const parent = await createImageOnlyMessage({
      conversationId: conversation.id,
      metadata: image.metadata,
      role: 'assistant',
      agentId: 'coder',
    })

    const result = await service.sendMessage(conversation.id, 'What should I change?', {
      replyToMessageId: parent.id,
    })

    const runtimeInput = calls[0]?.body
    expect(runtimeInput.userMessage.content).toContain(`[Replying to assistant coder (${parent.id})]`)
    expect(runtimeInput.userMessage.content).toContain('> [图片]')

    const replyMessage = result.messages.find((message) => message.parentMessageId === parent.id)
    expect(replyMessage?.metadataJson).toMatchObject({
      replyTo: {
        messageId: parent.id,
        excerpt: '[图片]',
      },
    })
  })

  it('replays image-only regenerate sources instead of rejecting them', async () => {
    const { calls, service } = createRuntimeCapture()
    const conversation = await createSingleAgentConversation('Image regenerate')
    const image = await createImageAsset(conversation.id, 'regenerate-source.png')
    const trigger = await createImageOnlyMessage({
      conversationId: conversation.id,
      metadata: image.metadata,
      role: 'user',
    })
    const sourceRun = await createRun({
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
      mode: 'single',
      status: 'completed',
      runtimeId: 'runtime_source_image_regenerate',
    })
    const sourceAssistant = await createMessage({
      conversationId: conversation.id,
      runId: sourceRun.id,
      surface: 'chat',
      role: 'assistant',
      senderType: 'agent',
      senderId: 'coder',
      agentId: 'coder',
      status: 'completed',
      completedAt: '2026-06-08T08:01:00.000Z',
    })
    await createMessagePart({
      messageId: sourceAssistant.id,
      conversationId: conversation.id,
      runId: sourceRun.id,
      partKey: 'text',
      partIndex: 0,
      type: 'text',
      state: 'done',
      text: 'Original visual answer.',
    })

    const result = await service.regenerateAssistantMessage(conversation.id, sourceAssistant.id)

    expect(calls[0]?.body.userMessage.content).toContain(`[Regenerating assistant message ${sourceAssistant.id}]`)
    expect(calls[0]?.body.userMessage.parts).toEqual([
      expect.objectContaining({ type: 'text' }),
      expect.objectContaining({
        type: 'image',
        filename: 'regenerate-source.png',
      }),
    ])
    const regeneratedTrigger = result.messages.find((message) =>
      message.role === 'user' &&
      message.id !== trigger.id &&
      message.metadataJson?.regenerate
    )
    expect(regeneratedTrigger?.parts.map((part) => part.type)).toEqual(['image'])
  })

  it('uses image fallback for image-only pinned context', async () => {
    const { calls, service } = createRuntimeCapture()
    const conversation = await createSingleAgentConversation('Pinned image')
    const image = await createImageAsset(conversation.id, 'pinned.png')
    const pinnedMessage = await createImageOnlyMessage({
      conversationId: conversation.id,
      metadata: image.metadata,
    })
    await createMessagePin({
      conversationId: conversation.id,
      messageId: pinnedMessage.id,
      sortOrder: 0,
    })

    await service.sendMessage(conversation.id, 'Use pinned visual context.')

    expect(calls[0]?.body.pinnedMessages[0]).toMatchObject({
      messageId: pinnedMessage.id,
      content: '[图片]',
    })
  })

  it('uses a multiple-image fallback for last message preview events', async () => {
    const { events, service } = createRuntimeCapture()
    const conversation = await createSingleAgentConversation('Multiple image preview')
    const firstImage = await createImageAsset(conversation.id, 'first.png')
    const secondImage = await createImageAsset(conversation.id, 'second.png')

    await service.sendMessage(conversation.id, '', {
      attachments: [
        { kind: 'image', assetId: firstImage.metadata.assetId },
        { kind: 'image', assetId: secondImage.metadata.assetId },
      ],
    })

    expect(events.find((event) => event.type === 'conversation.last_message.updated')?.payload)
      .toMatchObject({ lastMessageContent: '[2 张图片]' })
  })

  it('rejects too many image attachments with a stable error code', async () => {
    const { calls, service } = createRuntimeCapture()
    const conversation = await createSingleAgentConversation('Too many images')

    await expect(
      service.sendMessage(conversation.id, 'Too many images', {
        attachments: Array.from({ length: CONVERSATION_IMAGE_MAX_PER_MESSAGE + 1 }, (_, index) => ({
          kind: 'image' as const,
          assetId: `asset_${index}`,
        })),
      }),
    ).rejects.toMatchObject({
      code: 'IMAGE_ATTACHMENT_LIMIT_EXCEEDED',
    })
    expect(calls).toEqual([])
  })

  it('rejects missing image assets before creating a user message', async () => {
    const { calls, service } = createRuntimeCapture()
    const conversation = await createSingleAgentConversation('Missing image asset')

    await expect(
      service.sendMessage(conversation.id, '', {
        attachments: [
          { kind: 'image', assetId: 'missing_image_asset' },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'IMAGE_ASSET_NOT_FOUND',
    })

    expect(calls).toEqual([])
    expect(await listMessagesWithParts(conversation.id)).toEqual([])
  })
})

describe('reply message context', () => {
  function createRuntimeCapture(settingsProvider?: () => {
    diagnostics: {
      includeModelStream: boolean
      includeReasoning: boolean
      includeRawModelChunks: boolean
    }
  }) {
    const calls: Array<{ method: string; path: string; body: any }> = []
    const runtimeClient = {
      forward: async (method: string, path: string, body: unknown) => {
        calls.push({ method, path, body })
        return {
          status: 201,
          data: {
            runId: `runtime_reply_${randomUUID()}`,
            status: 'queued',
            eventsUrl: '/runtime/runs/runtime_reply/events',
          },
        }
      },
    }
    const service = new RunPersistenceService(
      runtimeClient as never,
      { publish: () => {} } as never,
      settingsProvider as never,
    )
    ;(service as any).startRuntimeConsumer = () => {}
    return { calls, service }
  }

  async function createSingleAgentConversation(title: string) {
    const conversation = await createConversation({
      title,
      mode: 'single',
    })
    await createConversationAgent({
      conversationId: conversation.id,
      agentId: 'coder',
      sortOrder: 0,
    })
    return conversation
  }

  async function createTextMessage(input: {
    conversationId: string
    role: 'user' | 'assistant' | 'system'
    text: string
    agentId?: string | null
    parentMessageId?: string | null
    metadataJson?: Record<string, unknown>
  }) {
    const message = await createMessage({
      conversationId: input.conversationId,
      surface: 'chat',
      role: input.role,
      senderType: input.role === 'user' ? 'user' : input.role === 'assistant' ? 'agent' : 'system',
      senderId: input.role === 'user' ? 'user' : input.agentId ?? null,
      agentId: input.agentId ?? null,
      parentMessageId: input.parentMessageId ?? null,
      status: 'completed',
      metadataJson: input.metadataJson,
      completedAt: '2026-06-04T08:00:00.000Z',
    })
    await createMessagePart({
      messageId: message.id,
      conversationId: input.conversationId,
      partKey: 'text',
      partIndex: 0,
      type: 'text',
      state: 'done',
      text: input.text,
    })
    return message
  }

  it('uses output settings diagnostics when creating the runtime input', async () => {
    const diagnostics = {
      includeModelStream: false,
      includeReasoning: false,
      includeRawModelChunks: true,
    }
    const { calls, service } = createRuntimeCapture(() => ({ diagnostics }))
    const conversation = await createSingleAgentConversation('Diagnostics settings')

    await service.sendMessage(conversation.id, 'Use the current output settings.')

    expect(calls[0]?.body.diagnostics).toEqual(diagnostics)
  })

  it('persists a reply snapshot while sending reply context to the runtime input', async () => {
    const { calls, service } = createRuntimeCapture()
    const conversation = await createSingleAgentConversation('Reply send')
    const parent = await createTextMessage({
      conversationId: conversation.id,
      role: 'assistant',
      agentId: 'coder',
      text: 'Use the shared formatter for all replay paths.',
    })

    const result = await service.sendMessage(conversation.id, 'Can you expand that?', {
      replyToMessageId: parent.id,
    })

    const runtimeInput = calls[0]?.body
    expect(runtimeInput.userMessage.content).toContain(`[Replying to assistant coder (${parent.id})]`)
    expect(runtimeInput.userMessage.content).toContain('> Use the shared formatter for all replay paths.')
    expect(runtimeInput.userMessage.content).toContain('Can you expand that?')

    const replyMessage = result.messages.find((message) => message.parentMessageId === parent.id)
    expect(replyMessage?.metadataJson).toMatchObject({
      replyTo: {
        messageId: parent.id,
        role: 'assistant',
        senderType: 'agent',
        senderId: 'coder',
        agentId: 'coder',
        excerpt: 'Use the shared formatter for all replay paths.',
      },
    })
    expect(replyMessage?.parts[0]?.text).toBe('Can you expand that?')
  })

  it('formats pinned reply messages before truncating pinned context', async () => {
    const { calls, service } = createRuntimeCapture()
    const conversation = await createSingleAgentConversation('Pinned reply')
    const parent = await createTextMessage({
      conversationId: conversation.id,
      role: 'assistant',
      agentId: 'coder',
      text: 'The pinned parent answer.',
    })
    const pinnedReply = await createTextMessage({
      conversationId: conversation.id,
      role: 'user',
      text: 'This reply should keep its context when pinned.',
      parentMessageId: parent.id,
      metadataJson: {
        replyTo: {
          messageId: parent.id,
          role: 'assistant',
          senderType: 'agent',
          senderId: 'coder',
          agentId: 'coder',
          createdAt: parent.createdAt,
          excerpt: 'The pinned parent answer.',
        },
      },
    })
    await createMessagePin({
      conversationId: conversation.id,
      messageId: pinnedReply.id,
      sortOrder: 0,
    })

    await service.sendMessage(conversation.id, 'Continue from pinned context.')

    const pinned = calls[0]?.body.pinnedMessages[0]
    expect(pinned?.messageId).toBe(pinnedReply.id)
    const pinnedContent = String(pinned?.content)
    expect(pinnedContent).toContain(`[Replying to assistant coder (${parent.id})]`)
    expect(pinnedContent).toContain('> The pinned parent answer.')
  })

  it('rejects reply targets from other conversations', async () => {
    const { service } = createRuntimeCapture()
    const conversation = await createSingleAgentConversation('Reply owner')
    const otherConversation = await createSingleAgentConversation('Reply other')
    const otherMessage = await createTextMessage({
      conversationId: otherConversation.id,
      role: 'assistant',
      agentId: 'coder',
      text: 'Other conversation message.',
    })

    await expect(
      service.sendMessage(conversation.id, 'Do not allow this.', {
        replyToMessageId: otherMessage.id,
      }),
    ).rejects.toMatchObject({
      code: 'REPLY_TARGET_INVALID',
    })
  })
})

describe('regenerate assistant message', () => {
  function createRuntimeCapture() {
    const calls: Array<{ method: string; path: string; body: any }> = []
    const runtimeClient = {
      forward: async (method: string, path: string, body: unknown) => {
        calls.push({ method, path, body })
        return {
          status: 201,
          data: {
            runId: `runtime_regenerate_${randomUUID()}`,
            status: 'queued',
            eventsUrl: '/runtime/runs/runtime_regenerate/events',
          },
        }
      },
    }
    const service = new RunPersistenceService(
      runtimeClient as never,
      { publish: () => {} } as never,
    )
    ;(service as any).startRuntimeConsumer = () => {}
    return { calls, service }
  }

  async function createSingleAgentConversation(title: string) {
    const conversation = await createConversation({
      title,
      mode: 'single',
    })
    await createConversationAgent({
      conversationId: conversation.id,
      agentId: 'coder',
      sortOrder: 0,
    })
    return conversation
  }

  async function createTextMessage(input: {
    conversationId: string
    role: 'user' | 'assistant'
    text: string
    runId?: string | null
    agentId?: string | null
    status?: 'completed' | 'streaming'
  }) {
    const message = await createMessage({
      conversationId: input.conversationId,
      runId: input.runId ?? null,
      surface: 'chat',
      role: input.role,
      senderType: input.role === 'user' ? 'user' : 'agent',
      senderId: input.role === 'user' ? 'user' : input.agentId ?? null,
      agentId: input.agentId ?? null,
      status: input.status ?? 'completed',
      completedAt: input.status === 'streaming' ? null : '2026-06-05T08:00:00.000Z',
    })
    await createMessagePart({
      messageId: message.id,
      conversationId: input.conversationId,
      runId: input.runId ?? undefined,
      partKey: 'text',
      partIndex: 0,
      type: 'text',
      state: input.status === 'streaming' ? 'streaming' : 'done',
      text: input.text,
    })
    return message
  }

  it('copies the source trigger user message and sends a regenerate instruction to runtime', async () => {
    const { calls, service } = createRuntimeCapture()
    const conversation = await createSingleAgentConversation('Regenerate send')
    const trigger = await createTextMessage({
      conversationId: conversation.id,
      role: 'user',
      text: 'Original user request.',
    })
    const sourceRun = await createRun({
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
      mode: 'single',
      status: 'completed',
      runtimeId: 'runtime_source_regenerate',
    })
    const sourceAssistant = await createTextMessage({
      conversationId: conversation.id,
      role: 'assistant',
      agentId: 'coder',
      runId: sourceRun.id,
      text: 'Original assistant answer.',
    })

    const result = await service.regenerateAssistantMessage(conversation.id, sourceAssistant.id)

    const runtimeInput = calls[0]?.body
    expect(runtimeInput.userMessage.content).toContain('Original user request.')
    expect(runtimeInput.userMessage.content).toContain(`[Regenerating assistant message ${sourceAssistant.id}]`)
    expect(runtimeInput.userMessage.content).toContain('Please generate an alternative response')
    expect(runtimeInput.history.map((message: { id?: string }) => message.id)).toContain(sourceAssistant.id)

    const regeneratedTrigger = result.messages.find((message) =>
      message.role === 'user' &&
      message.id !== trigger.id &&
      message.metadataJson?.regenerate
    )
    expect(regeneratedTrigger?.parts[0]?.text).toBe('Original user request.')
    expect(regeneratedTrigger?.metadataJson).toMatchObject({
      regenerate: {
        sourceAssistantMessageId: sourceAssistant.id,
        sourceRunId: sourceRun.id,
        sourceTriggerMessageId: trigger.id,
      },
    })
  })

  it('rejects regenerate targets that are not completed assistant chat messages', async () => {
    const { service } = createRuntimeCapture()
    const conversation = await createSingleAgentConversation('Regenerate invalid')
    const userMessage = await createTextMessage({
      conversationId: conversation.id,
      role: 'user',
      text: 'Cannot regenerate users.',
    })

    await expect(
      service.regenerateAssistantMessage(conversation.id, userMessage.id),
    ).rejects.toMatchObject({
      code: 'REGENERATE_TARGET_INVALID',
    })
  })

  it('marks projected assistant messages as regenerated from the source assistant', async () => {
    const sourceAssistantMessageId = `msg_source_assistant_${randomUUID()}`
    const { service, runId } = await createProjectionFixture({
      inputJson: {
        participantAgentIds: ['coder'],
        regenerate: {
          sourceAssistantMessageId,
        },
      },
    })

    await (service as any).projectRuntimeEventsBatch(runId, [{
      sequence: 1,
      event: {
        id: `event_regenerated_message_${randomUUID()}`,
        runId: 'runtime_regenerated_projection',
        type: 'message.completed',
        timestamp: '2026-06-05T09:00:00.000Z',
        agentId: 'coder',
        messageId: 'msg_runtime_regenerated',
        messageIndex: 0,
        data: {
          content: 'Alternative assistant answer.',
        },
      },
    }])

    const projected = await findMessageByRunAndRuntimeMessageId(runId, 'msg_runtime_regenerated')
    expect(projected?.regeneratedFromId).toBe(sourceAssistantMessageId)
  })
})

describe('isRetryableRuntimeEventStreamError', () => {
  it('treats socket resets from runtime SSE as retryable', () => {
    const error = Object.assign(
      new Error('The socket connection was closed unexpectedly.'),
      { code: 'ECONNRESET' },
    )

    expect(isRetryableRuntimeEventStreamError(error)).toBe(true)
  })

  it('does not retry non-transport parsing errors', () => {
    expect(isRetryableRuntimeEventStreamError(new SyntaxError('bad json'))).toBe(false)
  })
})

describe('isPersistedTerminalRuntimeEvent', () => {
  it('recognizes terminal runtime events by stored type', () => {
    expect(isPersistedTerminalRuntimeEvent({
      type: 'run.completed',
      payloadJson: {},
    })).toBe(true)
  })

  it('recognizes terminal runtime events by payload event type', () => {
    expect(isPersistedTerminalRuntimeEvent({
      type: 'unknown',
      payloadJson: {
        event: {
          type: 'run.cancelled',
        },
      },
    })).toBe(true)
  })

  it('does not treat local run status as a persisted terminal event', () => {
    expect(isPersistedTerminalRuntimeEvent({
      type: 'agent.started',
      payloadJson: {
        status: 'completed',
        event: {
          type: 'agent.started',
        },
      },
    })).toBe(false)
  })
})

describe('toProductHubRunEventEnvelope', () => {
  it('preserves generation metadata on message events', () => {
    const generation = {
      executionId: 'execution_123',
      model: {
        providerId: 'openai',
        modelId: 'gpt-5.1',
        providerName: 'OpenAI',
        modelName: 'GPT-5.1',
        modelSourceAgentId: 'coder',
      },
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
      finishReason: 'stop',
      durationMs: 1200,
    }
    const envelope = toProductHubRunEventEnvelope({
      sequence: 1,
      event: {
        id: 'event_message_completed',
        runId: 'run_message',
        type: 'message.completed',
        timestamp: new Date().toISOString(),
        agentId: 'coder',
        messageId: 'msg_run_message_execution_123_0',
        messageIndex: 0,
        data: {
          content: 'hello',
          generation,
        },
      },
    })

    const eventData = envelope.event.data as { generation?: unknown }
    expect(eventData.generation).toEqual(generation)
  })

  it('preserves external model metadata on external message events', () => {
    const externalModel = {
      provider: 'opencode',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4',
      providerName: 'Anthropic',
      modelName: 'Claude Sonnet 4',
    }
    const envelope = toProductHubRunEventEnvelope({
      sequence: 1,
      event: {
        id: 'event_external_message_completed',
        runId: 'run_external_message',
        type: 'message.completed',
        timestamp: new Date().toISOString(),
        agentId: 'opencode',
        messageId: 'msg_run_external_message_opencode_0',
        messageIndex: 0,
        data: {
          content: 'hello from OpenCode',
          externalModel,
        },
      },
    })

    const eventData = envelope.event.data as { externalModel?: unknown }
    expect(eventData.externalModel).toEqual(externalModel)
  })

  it('projects bash tool output to a bounded UI preview', () => {
    const stdout = 'x'.repeat(13_000)
    const stderr = 'error'.repeat(3_000)
    const envelope = toProductHubRunEventEnvelope({
      sequence: 1,
      event: {
        id: 'event_bash_completed',
        runId: 'run_bash',
        type: 'tool.completed',
        timestamp: new Date().toISOString(),
        agentId: 'coder',
        toolCallId: 'tool_bash',
        toolName: 'bash',
        data: {
          status: 'completed',
          summary: 'bash exited with code 0',
          data: {
            command: 'npm test',
            cwd: '.',
            shell: 'powershell.exe',
            exitCode: 0,
            signal: null,
            stdout,
            stderr,
            stdoutBytes: stdout.length,
            stderrBytes: stderr.length,
            truncated: false,
            durationMs: 42,
          },
        },
      },
    })

    const eventData = envelope.event.data as { data: Record<string, unknown> }
    expect((eventData.data.stdout as string).length).toBe(12_000)
    expect((eventData.data.stderr as string).length).toBe(12_000)
    expect(eventData.data.stdoutCharacters).toBe(stdout.length)
    expect(eventData.data.stderrCharacters).toBe(stderr.length)
    expect(eventData.data.stdoutTruncatedForUi).toBe(true)
    expect(eventData.data.stderrTruncatedForUi).toBe(true)
  })
})

describe('workspace diff artifact projection', () => {
  it('projects terminal workspaceDiff into a diff artifact attached to the latest assistant message', async () => {
    const { service, conversationId, runId } = await createProjectionFixture()
    const terminalEventId = `event_workspace_diff_${randomUUID()}`
    const workspaceDiff = createWorkspaceDiffSummary()

    await (service as any).projectRuntimeEventsBatch(runId, [
      {
        sequence: 1,
        event: {
          id: 'event_message_completed',
          runId: 'runtime_workspace_diff',
          type: 'message.completed',
          timestamp: '2026-06-02T00:00:00.000Z',
          agentId: 'coder',
          messageId: 'msg_runtime_workspace_diff',
          messageIndex: 0,
          data: {
            content: 'I updated the workspace.',
          },
        },
      },
      {
        sequence: 2,
        event: {
          id: terminalEventId,
          runId: 'runtime_workspace_diff',
          type: 'run.completed',
          timestamp: '2026-06-02T00:01:00.000Z',
          data: {
            status: 'completed',
            workspaceDiff,
          },
        },
      },
    ])

    const artifacts = await listArtifacts({ conversationId, runId, type: 'diff' })
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.metadataJson).toMatchObject({
      source: 'runtime.workspaceDiff',
      runtimeEventId: terminalEventId,
      status: 'available',
      baselineDirty: false,
      changedFileCount: 1,
    })

    const versions = await listArtifactVersionsByArtifact(artifacts[0]!.id as string)
    expect(versions).toHaveLength(1)
    expect(versions[0]?.content).toContain('diff --git')
    expect(versions[0]?.diffJson).toMatchObject({
      summary: workspaceDiff.summary,
      stats: { filesChanged: 1 },
    })
    expect(artifacts[0]?.currentVersionId).toBe(versions[0]?.id)

    const messages = await service.listConversationMessages(conversationId)
    const assistant = messages.messages.find((message) => message.role === 'assistant')
    expect(assistant?.artifacts).toHaveLength(1)
    expect(assistant?.artifacts?.[0]?.currentVersion?.diffJson).toMatchObject({
      summary: workspaceDiff.summary,
    })
  })

  it('projects internal write_file changes into a tool-attributed ChangeSet', async () => {
    const { service, conversationId, runId } = await createProjectionFixture()
    const terminalEventId = `event_workspace_diff_changeset_${randomUUID()}`

    await (service as any).projectRuntimeEventsBatch(runId, [
      {
        sequence: 1,
        event: {
          id: `event_write_started_${randomUUID()}`,
          runId: 'runtime_workspace_diff_changeset',
          type: 'tool.started',
          timestamp: '2026-06-04T00:00:00.000Z',
          agentId: 'writer',
          messageId: 'msg_writer_changeset',
          toolCallId: 'tool_write_index',
          toolName: 'write_file',
          data: {
            riskLevel: 'medium',
          },
        },
      },
      {
        sequence: 2,
        event: {
          id: `event_write_completed_${randomUUID()}`,
          runId: 'runtime_workspace_diff_changeset',
          type: 'tool.completed',
          timestamp: '2026-06-04T00:00:01.000Z',
          agentId: 'writer',
          messageId: 'msg_writer_changeset',
          toolCallId: 'tool_write_index',
          toolName: 'write_file',
          data: {
            status: 'completed',
            summary: 'Wrote src/index.ts',
            data: {
              path: 'src/index.ts',
              created: false,
            },
          },
        },
      },
      {
        sequence: 3,
        event: {
          id: `event_writer_message_${randomUUID()}`,
          runId: 'runtime_workspace_diff_changeset',
          type: 'message.completed',
          timestamp: '2026-06-04T00:00:02.000Z',
          agentId: 'writer',
          messageId: 'msg_writer_changeset',
          messageIndex: 0,
          data: {
            content: 'Updated src/index.ts.',
          },
        },
      },
      {
        sequence: 4,
        event: {
          id: terminalEventId,
          runId: 'runtime_workspace_diff_changeset',
          type: 'run.completed',
          timestamp: '2026-06-04T00:00:03.000Z',
          data: {
            status: 'completed',
            workspaceDiff: createWorkspaceDiffSummary(),
          },
        },
      },
    ])

    const artifacts = await listArtifacts({ conversationId, runId, type: 'diff' })
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.metadataJson).toMatchObject({
      source: 'runtime.workspaceDiff',
      runtimeEventId: terminalEventId,
      attributionKind: 'tool',
      attributionConfidence: 'inferred',
      changeSetId: expect.any(String),
    })

    const detail = await service.getArtifactDetail(conversationId, artifacts[0]!.id as string)
    expect(detail.diff?.changeSet).toMatchObject({
      id: artifacts[0]?.metadataJson.changeSetId,
      status: 'available',
      baselineDirty: false,
      runOnlyReliable: true,
      attribution: {
        kind: 'tool',
        confidence: 'inferred',
        agentId: 'writer',
        toolCallId: 'tool_write_index',
        toolName: 'write_file',
        messageId: 'msg_writer_changeset',
      },
    })
    expect(detail.diff?.changedFiles[0]?.attribution).toMatchObject({
      kind: 'tool',
      confidence: 'inferred',
      agentId: 'writer',
      toolCallId: 'tool_write_index',
      toolName: 'write_file',
      messageId: 'msg_writer_changeset',
    })
    expect(detail.diff?.changeSet?.files[0]).toMatchObject({
      path: 'src/index.ts',
      attribution: {
        kind: 'tool',
        confidence: 'inferred',
        toolCallId: 'tool_write_index',
      },
    })
  })

  it('attributes group addressed workspaceDiff artifacts to the addressed agent', async () => {
    const { service, conversationId, runId } = await createProjectionFixture({
      mode: 'group',
      orchestratorAgentId: 'orchestrator',
      inputJson: {
        participantAgentIds: ['orchestrator', 'opencode'],
        addressedAgentIds: ['opencode'],
      },
    })
    const terminalEventId = `event_workspace_diff_addressed_${randomUUID()}`

    await (service as any).projectRuntimeEventsBatch(runId, [{
      sequence: 1,
      event: {
        id: terminalEventId,
        runId: 'runtime_workspace_diff_addressed',
        type: 'run.completed',
        timestamp: '2026-06-02T00:01:00.000Z',
        data: {
          status: 'completed',
          workspaceDiff: createWorkspaceDiffSummary(),
        },
      },
    }])

    const artifacts = await listArtifacts({ conversationId, runId, type: 'diff' })
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.createdByAgentId).toBe('opencode')

    const versions = await listArtifactVersionsByArtifact(artifacts[0]!.id as string)
    expect(versions[0]?.createdByAgentId).toBe('opencode')
  })

  it('does not create duplicate diff artifacts when a terminal event is replayed', async () => {
    const { service, conversationId, runId } = await createProjectionFixture()
    const terminalEvent = {
      id: `event_workspace_diff_replay_${randomUUID()}`,
      runId: 'runtime_workspace_diff_replay',
      type: 'run.completed',
      timestamp: '2026-06-02T00:01:00.000Z',
      data: {
        status: 'completed',
        workspaceDiff: createWorkspaceDiffSummary(),
      },
    }

    await (service as any).projectRuntimeEventsBatch(runId, [{ sequence: 1, event: terminalEvent }])
    await (service as any).projectRuntimeEventsBatch(runId, [{ sequence: 1, event: terminalEvent }])

    const artifacts = await listArtifacts({ conversationId, runId, type: 'diff' })
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.metadataJson).toMatchObject({
      changeSetId: expect.any(String),
    })
  })

  it('marks same-file internal write attribution as ambiguous when multiple tools match', async () => {
    const { service, conversationId, runId } = await createProjectionFixture()

    await (service as any).projectRuntimeEventsBatch(runId, [
      createCompletedWorkspaceWriteEvent(1, 'tool_write_first', 'writer'),
      createCompletedWorkspaceWriteEvent(2, 'tool_write_second', 'writer'),
      {
        sequence: 3,
        event: {
          id: `event_workspace_diff_ambiguous_${randomUUID()}`,
          runId: 'runtime_workspace_diff_ambiguous',
          type: 'run.completed',
          timestamp: '2026-06-04T00:00:03.000Z',
          data: {
            status: 'completed',
            workspaceDiff: createWorkspaceDiffSummary(),
          },
        },
      },
    ])

    const artifacts = await listArtifacts({ conversationId, runId, type: 'diff' })
    const detail = await service.getArtifactDetail(conversationId, artifacts[0]!.id as string)

    expect(detail.diff?.changeSet?.attribution).toMatchObject({
      kind: 'run',
      confidence: 'ambiguous',
    })
    expect(detail.diff?.changedFiles[0]?.attribution).toMatchObject({
      kind: 'run',
      confidence: 'ambiguous',
      candidateToolCallIds: ['tool_write_first', 'tool_write_second'],
    })
  })

  it('skips no-change workspaceDiff summaries', async () => {
    const { service, conversationId, runId } = await createProjectionFixture()
    await (service as any).projectRuntimeEventsBatch(runId, [{
      sequence: 1,
      event: {
        id: `event_workspace_diff_no_changes_${randomUUID()}`,
        runId: 'runtime_workspace_diff_no_changes',
        type: 'run.completed',
        timestamp: '2026-06-02T00:01:00.000Z',
        data: {
          status: 'completed',
          workspaceDiff: {
            ...createWorkspaceDiffSummary(),
            changedFiles: [],
            stats: {
              filesChanged: 0,
              additions: 0,
              deletions: 0,
              modified: 0,
              added: 0,
              deleted: 0,
              renamed: 0,
              untracked: 0,
              conflicted: 0,
            },
            summary: 'No workspace changes detected',
          },
        },
      },
    }])

    const artifacts = await listArtifacts({ conversationId, runId, type: 'diff' })
    expect(artifacts).toHaveLength(0)
  })
})

describe('deployment artifact projection', () => {
  it('projects deployment events into an idempotent sanitized deployment artifact', async () => {
    const { service, conversationId, runId } = await createProjectionFixture({
      inputJson: {
        participantAgentIds: ['deploy'],
      },
    })
    const deploymentId = `deployment_${randomUUID()}`
    const commandId = `cmd_${randomUUID()}`
    const events = [
      {
        sequence: 1,
        event: {
          id: `event_deployment_started_${randomUUID()}`,
          runId: 'runtime_deployment_projection',
          type: 'deployment.started',
          timestamp: '2026-06-09T00:00:00.000Z',
          agentId: 'deploy',
          data: {
            deploymentId,
            conversationId,
            status: 'running',
            title: 'Production deployment',
            server: {
              id: 'srv_1',
              displayName: 'Production',
              hostLabel: 'prod.example.com',
              user: 'deploy',
              privateKey: 'must-not-leak',
              identityFilePath: 'C:\\Users\\me\\.ssh\\id_rsa',
            },
          },
        },
      },
      {
        sequence: 2,
        event: {
          id: `event_deployment_log_${randomUUID()}`,
          runId: 'runtime_deployment_projection',
          type: 'deployment.log.appended',
          timestamp: '2026-06-09T00:00:01.000Z',
          agentId: 'deploy',
          data: {
            deploymentId,
            conversationId,
            commandId,
            stream: 'stdout',
            text: 'docker ok\n',
            token: 'must-not-leak',
          },
        },
      },
      {
        sequence: 3,
        event: {
          id: `event_deployment_completed_${randomUUID()}`,
          runId: 'runtime_deployment_projection',
          type: 'deployment.completed',
          timestamp: '2026-06-09T00:00:02.000Z',
          agentId: 'deploy',
          data: {
            deploymentId,
            conversationId,
            status: 'completed',
            deploymentUrl: 'https://app.example.com',
            summary: 'Published',
            health: {
              url: 'https://app.example.com',
              ok: true,
              status: 200,
              secret: 'must-not-leak',
            },
          },
        },
      },
    ]

    await (service as any).projectRuntimeEventsBatch(runId, events)
    await (service as any).projectRuntimeEventsBatch(runId, [events[2]])

    const artifacts = await listArtifacts({ conversationId, runId, type: 'deployment' })
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.status).toBe('ready')
    expect(artifacts[0]?.metadataJson).toMatchObject({
      source: 'runtime.deployment',
      deploymentId,
      latestEventSequence: 3,
      snapshot: {
        deploymentId,
        status: 'completed',
        title: 'Production deployment',
        server: {
          id: 'srv_1',
          displayName: 'Production',
          hostLabel: 'prod.example.com',
          user: 'deploy',
        },
        logs: [
          {
            commandId,
            stream: 'stdout',
            text: 'docker ok\n',
          },
        ],
        deploymentUrl: 'https://app.example.com',
        health: {
          url: 'https://app.example.com',
          ok: true,
          status: 200,
        },
      },
    })
    const snapshotJson = JSON.stringify(artifacts[0]?.metadataJson)
    expect(snapshotJson).not.toContain('must-not-leak')
    expect(snapshotJson).not.toContain('identityFilePath')

    const versions = await listArtifactVersionsByArtifact(artifacts[0]!.id as string)
    expect(versions).toHaveLength(3)
    expect(versions[0]?.diffJson).toMatchObject({
      deploymentId,
      status: 'completed',
    })
  })

  it('sanitizes deployment payloads in product envelopes', () => {
    const envelope = toProductHubRunEventEnvelope({
      sequence: 1,
      event: {
        id: 'event_deployment_product',
        runId: 'run_deployment_product',
        type: 'deployment.connection.changed',
        timestamp: '2026-06-09T00:00:00.000Z',
        agentId: 'deploy',
        data: {
          deploymentId: 'dep_product',
          privateKey: 'must-not-leak',
          server: {
            id: 'srv_1',
            displayName: 'Production',
            token: 'must-not-leak',
          },
        },
      },
    })

    expect(JSON.stringify(envelope.event.data)).not.toContain('must-not-leak')
    expect(envelope.event.data).toMatchObject({
      deploymentId: 'dep_product',
      server: {
        id: 'srv_1',
        displayName: 'Production',
      },
    })
  })

  it('projects deployment progress health checks into the deployment artifact snapshot', async () => {
    const { service, conversationId, runId } = await createProjectionFixture({
      inputJson: {
        participantAgentIds: ['deploy'],
      },
    })
    const deploymentId = `deployment_${randomUUID()}`

    await (service as any).projectRuntimeEventsBatch(runId, [
      {
        sequence: 1,
        event: {
          id: `event_deployment_health_${randomUUID()}`,
          runId: 'runtime_deployment_health',
          type: 'deployment.progress.updated',
          timestamp: '2026-06-09T00:00:00.000Z',
          agentId: 'deploy',
          data: {
            deploymentId,
            conversationId,
            message: 'Deployment URL responded with 204',
            health: {
              url: 'https://app.example.com/health',
              ok: true,
              status: 204,
              durationMs: 42,
              token: 'must-not-leak',
            },
          },
        },
      },
    ])

    const artifacts = await listArtifacts({ conversationId, runId, type: 'deployment' })
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.metadataJson).toMatchObject({
      source: 'runtime.deployment',
      deploymentId,
      snapshot: {
        deploymentId,
        status: 'running',
        progress: {
          message: 'Deployment URL responded with 204',
        },
        health: {
          url: 'https://app.example.com/health',
          ok: true,
          status: 204,
          durationMs: 42,
        },
      },
    })
    expect(JSON.stringify(artifacts[0]?.metadataJson)).not.toContain('must-not-leak')
  })
})

describe('tool message projection', () => {
  it('backfills OpenCode tool parts and keeps diff artifacts on the assistant message', async () => {
    const { service, conversationId, runId } = await createProjectionFixture({
      inputJson: {
        participantAgentIds: ['opencode'],
      },
    })

    await (service as any).projectRuntimeEventsBatch(runId, [
      {
        sequence: 1,
        event: {
          id: `event_tool_started_${randomUUID()}`,
          runId: 'runtime_opencode_tool_order',
          type: 'tool.started',
          timestamp: '2026-06-03T00:00:00.000Z',
          agentId: 'opencode',
          messageId: 'msg_opencode_tool_order',
          toolCallId: 'opencode:call_edit',
          toolName: 'edit',
          data: {
            summary: 'OpenCode · edit',
            externalProvider: 'opencode',
            input: {
              filePath: 'src/index.ts',
            },
          },
        },
      },
      {
        sequence: 2,
        event: {
          id: `event_tool_completed_${randomUUID()}`,
          runId: 'runtime_opencode_tool_order',
          type: 'tool.completed',
          timestamp: '2026-06-03T00:00:01.000Z',
          agentId: 'opencode',
          messageId: 'msg_opencode_tool_order',
          toolCallId: 'opencode:call_edit',
          toolName: 'edit',
          data: {
            summary: 'OpenCode · edit',
            externalProvider: 'opencode',
            output: {
              title: 'Edited src/index.ts',
              output: 'updated file',
            },
          },
        },
      },
      {
        sequence: 3,
        event: {
          id: `event_message_completed_${randomUUID()}`,
          runId: 'runtime_opencode_tool_order',
          type: 'message.completed',
          timestamp: '2026-06-03T00:00:02.000Z',
          agentId: 'opencode',
          messageId: 'msg_opencode_tool_order',
          messageIndex: 0,
          data: {
            content: 'Done.',
          },
        },
      },
      {
        sequence: 4,
        event: {
          id: `event_workspace_diff_${randomUUID()}`,
          runId: 'runtime_opencode_tool_order',
          type: 'run.completed',
          timestamp: '2026-06-03T00:00:03.000Z',
          data: {
            status: 'completed',
            workspaceDiff: createWorkspaceDiffSummary(),
          },
        },
      },
    ])

    const response = await service.listConversationMessages(conversationId)
    const assistantMessage = response.messages.find((message) =>
      message.role === 'assistant' &&
      message.runtimeMessageId === 'msg_opencode_tool_order'
    )
    expect(assistantMessage).toBeTruthy()
    const toolPart = assistantMessage?.parts.find((part) =>
      part.type === 'tool' &&
      part.partKey === 'tool:opencode:call_edit'
    )
    expect(toolPart).toBeTruthy()
    expect(toolPart?.state).toBe('output-available')
    expect(toolPart?.payloadJson).toMatchObject({
      externalProvider: 'opencode',
      output: {
        title: 'Edited src/index.ts',
      },
    })
    expect(assistantMessage?.artifacts?.[0]).toMatchObject({
      type: 'diff',
      createdByAgentId: 'opencode',
      metadataJson: {
        attributionKind: 'agent',
        attributionConfidence: 'aggregate',
        changeSetId: expect.any(String),
      },
      currentVersion: {
        summary: '1 workspace file changed (+3/-1)',
      },
    })
    const detail = await service.getArtifactDetail(conversationId, assistantMessage!.artifacts![0]!.id)
    expect(detail.diff?.changeSet?.attribution).toMatchObject({
      kind: 'agent',
      confidence: 'aggregate',
      agentId: 'opencode',
    })
  })
})

describe('permission projection', () => {
  it('persists OpenCode external permission metadata without treating it as an internal tool approval', async () => {
    const { service, runId } = await createProjectionFixture({
      inputJson: {
        participantAgentIds: ['opencode'],
      },
    })

    await (service as any).projectRuntimeEventsBatch(runId, [
      {
        sequence: 1,
        event: {
          id: `event_permission_requested_${randomUUID()}`,
          runId: 'runtime_permission_requested',
          type: 'permission.requested',
          timestamp: '2026-06-03T00:00:00.000Z',
          agentId: 'opencode',
          messageId: 'msg_opencode_permission',
          toolCallId: 'opencode:call_edit',
          toolName: 'edit',
          data: {
            requestId: 'permission_opencode_edit',
            riskLevel: 'high',
            reason: 'OpenCode wants to edit src/index.ts',
            data: {
              externalProvider: 'opencode',
              providerSessionId: 'ses_opencode',
              providerPermissionId: 'perm_edit',
              permissionKind: 'edit',
              permissionType: 'file_write',
              patterns: ['src/index.ts'],
              providerToolCallId: 'call_edit',
              providerMessageId: 'msg_provider',
              providerMetadata: {
                title: 'Edit file',
              },
            },
          },
        },
      },
    ])

    const permissions = await listPermissionRequests({ runId })
    expect(permissions).toHaveLength(1)
    expect(permissions[0]?.runtimeRequestId).toBe('permission_opencode_edit')
    expect(permissions[0]?.toolCallId).toBe('opencode:call_edit')
    expect(permissions[0]?.permissionType).toBe('file_write')
    expect(permissions[0]?.dataJson).toMatchObject({
      externalProvider: 'opencode',
      providerSessionId: 'ses_opencode',
      providerPermissionId: 'perm_edit',
      permissionKind: 'edit',
      patterns: ['src/index.ts'],
    })
    expect(permissions[0]?.payloadJson).toMatchObject({
      requestId: 'permission_opencode_edit',
      data: {
        externalProvider: 'opencode',
      },
    })
    expect(permissions[0]?.metadataJson).toMatchObject({
      runtime: {
        requestId: 'permission_opencode_edit',
        eventType: 'permission.requested',
      },
      externalProvider: 'opencode',
      providerSessionId: 'ses_opencode',
      providerPermissionId: 'perm_edit',
      permissionKind: 'edit',
      providerToolCallId: 'call_edit',
      providerMessageId: 'msg_provider',
    })
  })
})

describe('artifact detail', () => {
  it('returns current version and normalized diff detail for a conversation artifact', async () => {
    const service = new RunPersistenceService(
      {} as never,
      { publish: () => {} } as never,
    )
    const conversation = await createConversation({
      title: 'Artifact detail',
      mode: 'single',
    })
    const artifact = await createArtifact({
      conversationId: conversation.id,
      type: 'diff',
      title: 'Workspace changes',
      status: 'ready',
      metadataJson: {
        source: 'runtime.workspaceDiff',
      },
    })
    const workspaceDiff = {
      ...createWorkspaceDiffSummary(),
      baselineDirty: true,
      runOnlyReliable: false,
      patch: {
        text: 'diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line\n',
        truncated: true,
      },
      limitations: ['git diff was bounded'],
    }
    const version = await createArtifactVersion({
      artifactId: artifact.id as string,
      version: 1,
      source: 'agent',
      language: 'diff',
      content: workspaceDiff.patch.text,
      summary: '1 file changed',
      diffJson: workspaceDiff,
      createdByAgentId: 'coder',
    })
    await updateArtifact(artifact.id as string, {
      currentVersionId: version.id as string,
    })

    const detail = await service.getArtifactDetail(conversation.id, artifact.id as string)

    expect(detail.artifact.id).toBe(artifact.id)
    expect(detail.currentVersion?.id).toBe(version.id)
    expect(detail.diff?.patchText).toContain('diff --git')
    expect(detail.diff?.patchTruncated).toBe(true)
    expect(detail.diff?.baselineDirty).toBe(true)
    expect(detail.diff?.runOnlyReliable).toBe(false)
    expect(detail.diff?.changedFiles).toEqual([{
      path: 'src/index.ts',
      status: ' M',
      additions: 3,
      deletions: 1,
    }])
    expect(detail.diff?.limitations).toContain('git diff was bounded')
    expect(detail.diff?.limitations.join('\n')).toContain('run-only patch')
  })

  it('does not expose artifacts across conversations', async () => {
    const service = new RunPersistenceService(
      {} as never,
      { publish: () => {} } as never,
    )
    const owner = await createConversation({
      title: 'Owner',
      mode: 'single',
    })
    const other = await createConversation({
      title: 'Other',
      mode: 'single',
    })
    const artifact = await createArtifact({
      conversationId: owner.id,
      type: 'code',
      title: 'Code artifact',
      status: 'ready',
    })

    try {
      await service.getArtifactDetail(other.id, artifact.id as string)
      throw new Error('Expected getArtifactDetail to fail')
    } catch (error) {
      expect((error as { code?: string }).code).toBe('ARTIFACT_NOT_FOUND')
    }
  })
})

describe('artifact revert', () => {
  it('previews a reliable diff artifact revert using the original run workspace', async () => {
    const calls: Array<{ method: string; path: string; body: any }> = []
    const runtimeClient = {
      forward: async (method: string, path: string, body: unknown) => {
        calls.push({ method, path, body })
        return {
          status: 200,
          data: {
            status: 'available',
            canApply: true,
            files: [{ path: 'src/index.ts', action: 'modify' }],
            warnings: [],
            source: {
              artifactId: (body as any).source.artifactId,
              changeSetId: (body as any).source.changeSetId,
              runId: (body as any).source.runId,
              patchDirection: 'reverse-applied',
            },
          },
        }
      },
    }
    const { service, conversationId, runId } = await createProjectionFixture({
      runtimeClient,
      inputJson: {
        participantAgentIds: ['coder'],
        workspace: {
          workspaceId: 'workspace_diff',
          backendType: 'local',
          rootPath: 'D:\\dev\\workspace',
        },
      },
    })

    await projectSourceDiffArtifact(service, runId)
    const [artifact] = await listArtifacts({ conversationId, runId, type: 'diff' })

    const preview = await service.previewArtifactRevert(conversationId, artifact!.id)

    expect(preview.status).toBe('available')
    expect(preview.source.artifactId).toBe(artifact!.id)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/runtime/workspace/revert/preview',
      body: {
        workspace: {
          workspaceId: 'workspace_diff',
          backendType: 'local',
          rootPath: 'D:\\dev\\workspace',
        },
        source: {
          artifactId: artifact!.id,
          patchText: expect.stringContaining('diff --git'),
          baselineDirty: false,
          runOnlyReliable: true,
        },
      },
    })
  })

  it('applies a revert once and persists a system message, diff artifact, and ChangeSet', async () => {
    const runtimeClient = {
      forward: async (_method: string, path: string, body: unknown) => {
        const preview = {
          status: 'available',
          canApply: true,
          files: [{ path: 'src/index.ts', action: 'modify' }],
          warnings: [],
          source: {
            artifactId: (body as any).source.artifactId,
            changeSetId: (body as any).source.changeSetId,
            runId: (body as any).source.runId,
            patchDirection: 'reverse-applied',
          },
        }
        return {
          status: 200,
          data: path.endsWith('/apply')
            ? {
                status: 'applied',
                operationId: 'revert_operation_test',
                preview,
                workspace: { workspaceId: 'workspace_diff', backendType: 'local' },
                appliedAt: '2026-06-04T00:00:00.000Z',
              }
            : preview,
        }
      },
    }
    const { service, conversationId, runId } = await createProjectionFixture({
      runtimeClient,
      inputJson: {
        participantAgentIds: ['coder'],
        workspace: {
          workspaceId: 'workspace_diff',
          backendType: 'local',
          rootPath: 'D:\\dev\\workspace',
        },
      },
    })
    await projectSourceDiffArtifact(service, runId)
    const [sourceArtifact] = await listArtifacts({ conversationId, runId, type: 'diff' })

    const applied = await service.applyArtifactRevert(conversationId, sourceArtifact!.id)
    const repeated = await service.applyArtifactRevert(conversationId, sourceArtifact!.id)

    expect(applied.status).toBe('applied')
    expect(repeated.status).toBe('already_applied')
    expect(repeated.artifact?.id).toBe(applied.artifact?.id)

    const artifacts = await listArtifacts({ conversationId, runId, type: 'diff', order: 'asc' })
    expect(artifacts).toHaveLength(2)
    expect(artifacts[1]?.metadataJson).toMatchObject({
      source: 'workspace.revert',
      revertsArtifactId: sourceArtifact!.id,
      revertOperationId: 'revert_operation_test',
      patchDirection: 'reverse-applied',
      changeSetId: expect.any(String),
    })

    const detail = await service.getArtifactDetail(conversationId, artifacts[1]!.id)
    expect(detail.diff?.operation).toMatchObject({
      type: 'revert',
      status: 'applied',
      revertsArtifactId: sourceArtifact!.id,
      patchDirection: 'reverse-applied',
    })
    expect(detail.diff?.changeSet?.attribution).toMatchObject({
      kind: 'run',
      confidence: 'aggregate',
    })

    const messages = await service.listConversationMessages(conversationId)
    const revertMessage = messages.messages.find((message) =>
      message.senderType === 'system' &&
      message.artifacts?.some((artifact) => artifact.id === applied.artifact?.id)
    )
    expect(revertMessage?.role).toBe('assistant')
    expect(revertMessage?.parts[0]?.text).toContain('已撤销本次工作区变更')
  })
})

describe('resolveAddressedAgentIds', () => {
  it('keeps default routing when no addressed agent is provided', () => {
    expect(resolveAddressedAgentIds({
      mode: 'group',
      agents: [
        { agentId: 'orchestrator' },
        { agentId: 'coder' },
      ],
    }, undefined)).toEqual([])
  })

  it('allows one conversation member to be addressed in a group chat', () => {
    expect(resolveAddressedAgentIds({
      mode: 'group',
      agents: [
        { agentId: 'orchestrator' },
        { agentId: 'coder' },
      ],
    }, ['coder'])).toEqual(['coder'])
  })

  it('rejects duplicate and multiple addressed agents', () => {
    expect(() => resolveAddressedAgentIds({
      mode: 'group',
      agents: [
        { agentId: 'orchestrator' },
        { agentId: 'coder' },
        { agentId: 'writer' },
      ],
    }, ['coder', 'coder'])).toThrow('Addressed agents must be unique')

    expect(() => resolveAddressedAgentIds({
      mode: 'group',
      agents: [
        { agentId: 'orchestrator' },
        { agentId: 'coder' },
        { agentId: 'writer' },
      ],
    }, ['coder', 'writer'])).toThrow('Only one addressed agent is supported in this version')
  })

  it('rejects addressed agents outside the conversation', () => {
    expect(() => resolveAddressedAgentIds({
      mode: 'group',
      agents: [
        { agentId: 'orchestrator' },
        { agentId: 'coder' },
      ],
    }, ['writer'])).toThrow('Addressed agent must be a conversation member')
  })

  it('only allows a single chat to address its only member', () => {
    expect(resolveAddressedAgentIds({
      mode: 'single',
      agents: [
        { agentId: 'coder' },
      ],
    }, ['coder'])).toEqual(['coder'])

    expect(() => resolveAddressedAgentIds({
      mode: 'single',
      agents: [
        { agentId: 'coder' },
        { agentId: 'writer' },
      ],
    }, ['coder'])).toThrow('Single chat can only address its only member')
  })
})

async function createProjectionFixture(options: {
  mode?: 'single' | 'group'
  orchestratorAgentId?: string
  inputJson?: Record<string, unknown>
  runtimeClient?: unknown
} = {}): Promise<{
  service: RunPersistenceService
  conversationId: string
  runId: string
}> {
  const service = new RunPersistenceService(
    (options.runtimeClient ?? {}) as never,
    { publish: () => {} } as never,
  )
  const conversation = await createConversation({
    title: 'Workspace diff projection',
    mode: 'single',
  })
  const triggerMessage = await createMessage({
    conversationId: conversation.id,
    surface: 'chat',
    role: 'user',
    senderType: 'user',
    senderId: 'user',
    status: 'completed',
    completedAt: '2026-06-02T00:00:00.000Z',
  })
  await createMessagePart({
    messageId: triggerMessage.id,
    conversationId: conversation.id,
    partKey: 'text',
    partIndex: 0,
    type: 'text',
    state: 'done',
    text: 'Please update the workspace.',
  })
  const run = await createRun({
    conversationId: conversation.id,
    triggerMessageId: triggerMessage.id,
    mode: options.mode ?? 'single',
    status: 'running',
    runtimeId: 'runtime_workspace_diff',
    orchestratorAgentId: options.orchestratorAgentId,
    inputJson: options.inputJson ?? {
      participantAgentIds: ['coder'],
    },
  })

  return {
    service,
    conversationId: conversation.id,
    runId: run.id,
  }
}

async function projectSourceDiffArtifact(
  service: RunPersistenceService,
  runId: string,
): Promise<void> {
  await (service as any).projectRuntimeEventsBatch(runId, [{
    sequence: 1,
    event: {
      id: `event_workspace_diff_source_${randomUUID()}`,
      runId: 'runtime_workspace_diff_source',
      type: 'run.completed',
      timestamp: '2026-06-04T00:00:03.000Z',
      data: {
        status: 'completed',
        workspaceDiff: createWorkspaceDiffSummary(),
      },
    },
  }])
}

function createWorkspaceDiffSummary() {
  return {
    version: 1,
    status: 'available',
    source: 'git',
    workspace: {
      workspaceId: 'workspace_diff',
      backendType: 'local',
      rootLabel: 'AgentHub',
    },
    baseline: {
      capturedAt: '2026-06-02T00:00:00.000Z',
      repository: 'available',
      branch: 'main',
      head: 'abc123',
      dirty: false,
      fileCount: 0,
    },
    final: {
      capturedAt: '2026-06-02T00:01:00.000Z',
      repository: 'available',
      branch: 'main',
      head: 'abc123',
      dirty: true,
      fileCount: 1,
    },
    baselineDirty: false,
    runOnlyReliable: true,
    changedFiles: [{
      path: 'src/index.ts',
      statusAfter: ' M',
      origin: 'new-since-baseline',
      additions: 3,
      deletions: 1,
    }],
    stats: {
      filesChanged: 1,
      additions: 3,
      deletions: 1,
      modified: 1,
      added: 0,
      deleted: 0,
      renamed: 0,
      untracked: 0,
      conflicted: 0,
    },
    patch: {
      text: 'diff --git a/src/index.ts b/src/index.ts\n+new line\n',
      bytes: 52,
      maxBytes: 204800,
      truncated: false,
    },
    summary: '1 workspace file changed (+3/-1)',
    limitations: [],
  }
}

function createCompletedWorkspaceWriteEvent(sequence: number, toolCallId: string, agentId: string) {
  return {
    sequence,
    event: {
      id: `event_${toolCallId}_${randomUUID()}`,
      runId: 'runtime_workspace_diff_ambiguous',
      type: 'tool.completed',
      timestamp: `2026-06-04T00:00:0${sequence}.000Z`,
      agentId,
      messageId: `msg_${toolCallId}`,
      toolCallId,
      toolName: 'write_file',
      data: {
        status: 'completed',
        summary: 'Wrote src/index.ts',
        data: {
          path: 'src/index.ts',
          created: false,
        },
      },
    },
  }
}
