import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import { safeJsonParse } from '../lib/utils'
import type { ArtifactType, ArtifactStatus, MetadataJson, SortOrder } from '../lib/types'

export interface CreateArtifactInput {
  conversationId: string
  runId?: string
  messageId?: string
  createdByAgentId?: string
  type: ArtifactType
  title: string
  status?: ArtifactStatus
  currentVersionId?: string
  metadataJson?: MetadataJson
}

export interface UpdateArtifactInput {
  title?: string
  status?: ArtifactStatus
  currentVersionId?: string | null
  metadataJson?: MetadataJson
}

export interface ListArtifactsFilter {
  conversationId?: string
  runId?: string
  type?: ArtifactType
  status?: ArtifactStatus
  limit?: number
  offset?: number
  order?: SortOrder
}

function toOutput(record: Record<string, unknown>) {
  return {
    ...record,
    metadataJson: safeJsonParse(record.metadataJson as string | undefined, {}),
  }
}

export async function createArtifact(input: CreateArtifactInput) {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  const record = await db.artifact.create({
    data: {
      id: generateId('art'),
      conversationId: input.conversationId,
      runId: input.runId ?? null,
      messageId: input.messageId ?? null,
      createdByAgentId: input.createdByAgentId ?? null,
      type: input.type,
      title: input.title,
      status: input.status ?? 'draft',
      currentVersionId: input.currentVersionId ?? null,
      metadataJson: JSON.stringify(input.metadataJson ?? {}),
      createdAt: now,
      updatedAt: now,
    },
  })
  return toOutput(record as Record<string, unknown>)
}

export async function findArtifactById(id: string) {
  const db = getPrismaClient()
  const record = await db.artifact.findUnique({ where: { id } })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function listArtifacts(filter: ListArtifactsFilter = {}) {
  const db = getPrismaClient()
  const { conversationId, runId, type, status, limit = 50, offset = 0, order = 'desc' } = filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {}
  if (conversationId) where.conversationId = conversationId
  if (runId) where.runId = runId
  if (type) where.type = type
  if (status) where.status = status

  const records = await db.artifact.findMany({
    where,
    orderBy: { createdAt: order },
    take: limit,
    skip: offset,
  })
  return records.map(r => toOutput(r as Record<string, unknown>))
}

export async function updateArtifact(id: string, input: UpdateArtifactInput) {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { updatedAt: now }
  if (input.title !== undefined) data.title = input.title
  if (input.status !== undefined) data.status = input.status
  if (input.currentVersionId !== undefined) data.currentVersionId = input.currentVersionId
  if (input.metadataJson !== undefined) data.metadataJson = JSON.stringify(input.metadataJson)

  const record = await db.artifact.update({ where: { id }, data })
  return toOutput(record as Record<string, unknown>)
}

export async function deleteArtifactById(id: string) {
  const db = getPrismaClient()
  await db.artifact.delete({ where: { id } })
}

export async function countArtifacts(filter: { conversationId?: string; type?: ArtifactType; status?: ArtifactStatus } = {}): Promise<number> {
  const db = getPrismaClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {}
  if (filter.conversationId) where.conversationId = filter.conversationId
  if (filter.type) where.type = filter.type
  if (filter.status) where.status = filter.status
  return db.artifact.count({ where })
}

export async function findArtifactWithVersions(id: string) {
  const db = getPrismaClient()
  return db.artifact.findUnique({
    where: { id },
    include: { versions: { orderBy: { version: 'desc' } } },
  })
}