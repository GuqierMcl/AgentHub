import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, initDatabase } from '../lib/db'
import { createConversation } from './conversation.repo'
import {
  findExternalAgentSessionHint,
  listExternalAgentSessions,
  patchExternalAgentSessionMetadata,
  upsertExternalAgentSession,
} from './external-agent-session.repo'

let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'hub-server-external-agent-session-'))
  const dbPath = join(tempDir, 'hub.db').replace(/\\/g, '/')
  await initDatabase(`file:${dbPath}`)
})

afterAll(async () => {
  await closeDatabase()
  if (tempDir) {
    try {
      await rm(tempDir, { recursive: true, force: true })
    } catch {
      // SQLite/Prisma can release WAL file handles slightly after disconnect on Windows.
    }
  }
})

describe('external agent session repository', () => {
  it('upserts provider session links and resolves direct conversation hints', async () => {
    const conversation = await createConversation({
      title: 'OpenCode direct chat',
      mode: 'single',
    })

    const created = await upsertExternalAgentSession({
      provider: 'opencode',
      agentId: 'opencode',
      conversationId: conversation.id,
      workspaceIdentity: 'workspace_one',
      scope: 'conversation-visible',
      providerSessionId: 'provider_session_one',
      runId: 'run_first',
      metadataJson: { source: 'agent.started' },
    })

    expect(created.id).toStartWith('eas_')
    expect(created.status).toBe('active')
    expect(created.metadataJson).toEqual({ source: 'agent.started' })

    const updated = await upsertExternalAgentSession({
      provider: 'opencode',
      agentId: 'opencode',
      conversationId: conversation.id,
      workspaceIdentity: 'workspace_one',
      scope: 'conversation-visible',
      providerSessionId: 'provider_session_one',
      runId: 'run_second',
      handoffSummary: 'OpenCode previously changed the workspace.',
      metadataJson: { source: 'replayed-agent.started' },
    })

    expect(updated.id).toBe(created.id)
    expect(updated.runId).toBe('run_second')
    expect(updated.handoffSummary).toBe('OpenCode previously changed the workspace.')
    expect(updated.metadataJson).toEqual({ source: 'replayed-agent.started' })

    const hint = await findExternalAgentSessionHint({
      provider: 'opencode',
      agentId: 'opencode',
      conversationId: conversation.id,
      workspaceIdentity: 'workspace_one',
      scope: 'conversation-visible',
      status: 'active',
    })

    expect(hint?.providerSessionId).toBe('provider_session_one')
    expect(hint?.handoffSummary).toBe('OpenCode previously changed the workspace.')

    const mismatchedWorkspace = await findExternalAgentSessionHint({
      provider: 'opencode',
      agentId: 'opencode',
      conversationId: conversation.id,
      workspaceIdentity: 'workspace_two',
      scope: 'conversation-visible',
      status: 'active',
    })

    expect(mismatchedWorkspace).toBeNull()

    const sessions = await listExternalAgentSessions({
      conversationId: conversation.id,
      provider: 'opencode',
    })
    expect(sessions.map((session) => session.providerSessionId)).toEqual(['provider_session_one'])
  })

  it('merges metadata across upsert and patch operations', async () => {
    const conversation = await createConversation({
      title: 'OpenCode context metadata',
      mode: 'single',
    })

    await upsertExternalAgentSession({
      provider: 'opencode',
      agentId: 'opencode',
      conversationId: conversation.id,
      workspaceIdentity: 'workspace_context',
      scope: 'conversation-visible',
      providerSessionId: 'provider_session_context',
      runId: 'run_context_first',
      metadataJson: {
        runtimeRunId: 'runtime_first',
        contextBridge: {
          lastSyncedMessageId: 'msg_first',
        },
      },
    })

    const updated = await upsertExternalAgentSession({
      provider: 'opencode',
      agentId: 'opencode',
      conversationId: conversation.id,
      workspaceIdentity: 'workspace_context',
      scope: 'conversation-visible',
      providerSessionId: 'provider_session_context',
      runId: 'run_context_second',
      metadataJson: {
        providerRunId: 'provider_second',
      },
    })

    expect(updated.metadataJson).toEqual({
      runtimeRunId: 'runtime_first',
      providerRunId: 'provider_second',
      contextBridge: {
        lastSyncedMessageId: 'msg_first',
      },
    })

    const patched = await patchExternalAgentSessionMetadata({
      provider: 'opencode',
      providerSessionId: 'provider_session_context',
    }, {
      contextBridge: {
        lastSyncedMessageId: 'msg_second',
        lastSyncedAt: '2026-06-02T00:00:00.000Z',
      },
    })

    expect(patched?.metadataJson).toEqual({
      runtimeRunId: 'runtime_first',
      providerRunId: 'provider_second',
      contextBridge: {
        lastSyncedMessageId: 'msg_second',
        lastSyncedAt: '2026-06-02T00:00:00.000Z',
      },
    })
  })
})
