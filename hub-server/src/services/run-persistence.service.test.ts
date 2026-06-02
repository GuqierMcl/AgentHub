import { describe, expect, it } from 'bun:test'
import {
  buildOpenCodeExternalContextPacket,
  RuntimeEventBatcher,
  isPersistedTerminalRuntimeEvent,
  isRetryableRuntimeEventStreamError,
  resolveAddressedAgentIds,
  toProductHubRunEventEnvelope,
} from './run-persistence.service'

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
      senderId: input.role === 'user' ? 'user' : input.agentId ?? null,
      agentId: input.agentId ?? null,
      taskId: null,
      groupId: null,
      parentMessageId: null,
      regeneratedFromId: null,
      status: input.status ?? 'completed',
      finishReason: null,
      firstEventSequence: null,
      lastEventSequence: null,
      metadataJson: '{}',
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
  }) {
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
    } as never
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
