import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, initDatabase } from '../lib/db'
import { prepareTestDatabase } from '../test-utils/database'
import { createConversation } from '../repositories/conversation.repo'
import { createMessage } from '../repositories/message.repo'
import { createMessagePart } from '../repositories/message-part.repo'
import { createRun } from '../repositories/run.repo'
import { createArtifact, listArtifacts, updateArtifact } from '../repositories/artifact.repo'
import { createArtifactVersion, listArtifactVersionsByArtifact } from '../repositories/artifact-version.repo'
import { listPermissionRequests } from '../repositories/permission-request.repo'
import {
  buildOpenCodeExternalContextPacket,
  RuntimeEventBatcher,
  RunPersistenceService,
  isPersistedTerminalRuntimeEvent,
  isRetryableRuntimeEventStreamError,
  resolveAddressedAgentIds,
  toProductHubRunEventEnvelope,
} from './run-persistence.service'

let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'hub-server-run-persistence-'))
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
