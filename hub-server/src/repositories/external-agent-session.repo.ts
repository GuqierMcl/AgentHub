import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import { safeJsonParse } from '../lib/utils'
import type { MetadataJson, SortOrder } from '../lib/types'

export type ExternalSessionScope = 'conversation-visible' | 'delegated-task'

export interface UpsertExternalAgentSessionInput {
  provider: string
  agentId: string
  conversationId: string
  workspaceIdentity: string
  scope: ExternalSessionScope
  providerSessionId: string
  parentProviderSessionId?: string | null
  runId?: string | null
  taskId?: string | null
  status?: string
  handoffSummary?: string | null
  lastSyncedRunEventId?: string | null
  metadataJson?: MetadataJson
}

export interface FindExternalAgentSessionFilter {
  provider: string
  agentId: string
  conversationId: string
  workspaceIdentity: string
  scope: ExternalSessionScope
  taskId?: string | null
  status?: string
}

export interface ExternalAgentSessionOutput {
  id: string
  provider: string
  agentId: string
  conversationId: string
  workspaceIdentity: string
  scope: ExternalSessionScope
  providerSessionId: string
  parentProviderSessionId: string | null
  runId: string | null
  taskId: string | null
  status: string
  handoffSummary: string | null
  lastSyncedRunEventId: string | null
  metadataJson: MetadataJson
  createdAt: string
  updatedAt: string
}

export interface ListExternalAgentSessionsFilter {
  conversationId?: string
  provider?: string
  agentId?: string
  scope?: ExternalSessionScope
  status?: string
  limit?: number
  offset?: number
  order?: SortOrder
}

function toOutput(record: Record<string, unknown>): ExternalAgentSessionOutput {
  return {
    ...record,
    metadataJson: safeJsonParse(record.metadataJson as string | undefined, {}),
  } as ExternalAgentSessionOutput
}

function mergeMetadataJson(
  existing: string | undefined,
  patch: MetadataJson | undefined,
): MetadataJson {
  const parsed = safeJsonParse(existing, {})
  const current = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? parsed as MetadataJson
    : {}
  return {
    ...current,
    ...(patch ?? {}),
  }
}

export async function upsertExternalAgentSession(
  input: UpsertExternalAgentSessionInput,
): Promise<ExternalAgentSessionOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  const existing = await db.externalAgentSession.findUnique({
    where: {
      provider_providerSessionId: {
        provider: input.provider,
        providerSessionId: input.providerSessionId,
      },
    },
  })
  const metadataJson = JSON.stringify(mergeMetadataJson(
    existing?.metadataJson as string | undefined,
    input.metadataJson,
  ))
  const record = await db.externalAgentSession.upsert({
    where: {
      provider_providerSessionId: {
        provider: input.provider,
        providerSessionId: input.providerSessionId,
      },
    },
    create: {
      id: generateId('eas'),
      provider: input.provider,
      agentId: input.agentId,
      conversationId: input.conversationId,
      workspaceIdentity: input.workspaceIdentity,
      scope: input.scope,
      providerSessionId: input.providerSessionId,
      parentProviderSessionId: input.parentProviderSessionId ?? null,
      runId: input.runId ?? null,
      taskId: input.taskId ?? null,
      status: input.status ?? 'active',
      handoffSummary: input.handoffSummary ?? null,
      lastSyncedRunEventId: input.lastSyncedRunEventId ?? null,
      metadataJson,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      agentId: input.agentId,
      conversationId: input.conversationId,
      workspaceIdentity: input.workspaceIdentity,
      scope: input.scope,
      parentProviderSessionId: input.parentProviderSessionId ?? null,
      runId: input.runId ?? null,
      taskId: input.taskId ?? null,
      status: input.status ?? 'active',
      handoffSummary: input.handoffSummary ?? null,
      lastSyncedRunEventId: input.lastSyncedRunEventId ?? null,
      metadataJson,
      updatedAt: now,
    },
  })
  return toOutput(record as Record<string, unknown>)
}

export async function patchExternalAgentSessionMetadata(
  filter: {
    provider: string
    providerSessionId: string
  },
  patch: MetadataJson,
): Promise<ExternalAgentSessionOutput | null> {
  const db = getPrismaClient()
  const existing = await db.externalAgentSession.findUnique({
    where: {
      provider_providerSessionId: {
        provider: filter.provider,
        providerSessionId: filter.providerSessionId,
      },
    },
  })
  if (!existing) return null

  const record = await db.externalAgentSession.update({
    where: {
      provider_providerSessionId: {
        provider: filter.provider,
        providerSessionId: filter.providerSessionId,
      },
    },
    data: {
      metadataJson: JSON.stringify(mergeMetadataJson(
        existing.metadataJson as string | undefined,
        patch,
      )),
      updatedAt: new Date().toISOString(),
    },
  })
  return toOutput(record as Record<string, unknown>)
}

export async function findExternalAgentSessionHint(
  filter: FindExternalAgentSessionFilter,
): Promise<ExternalAgentSessionOutput | null> {
  const db = getPrismaClient()
  const record = await db.externalAgentSession.findFirst({
    where: {
      provider: filter.provider,
      agentId: filter.agentId,
      conversationId: filter.conversationId,
      workspaceIdentity: filter.workspaceIdentity,
      scope: filter.scope,
      status: filter.status ?? 'active',
      ...(filter.taskId !== undefined ? { taskId: filter.taskId } : {}),
    },
    orderBy: { updatedAt: 'desc' },
  })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function listExternalAgentSessions(
  filter: ListExternalAgentSessionsFilter = {},
): Promise<ExternalAgentSessionOutput[]> {
  const db = getPrismaClient()
  const { limit = 50, offset = 0, order = 'desc' } = filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {}
  if (filter.conversationId) where.conversationId = filter.conversationId
  if (filter.provider) where.provider = filter.provider
  if (filter.agentId) where.agentId = filter.agentId
  if (filter.scope) where.scope = filter.scope
  if (filter.status) where.status = filter.status

  const records = await db.externalAgentSession.findMany({
    where,
    orderBy: { updatedAt: order },
    take: limit,
    skip: offset,
  })
  return records.map((record) => toOutput(record as Record<string, unknown>))
}
