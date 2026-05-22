import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import type { PermissionType, PermissionStatus, MetadataJson, SortOrder } from '../lib/types'

export interface CreatePermissionRequestInput {
  conversationId: string
  runId: string
  agentId: string
  messageId?: string
  permissionType: PermissionType
  target: string
  description: string
  status?: PermissionStatus
  expiresAt?: string
  metadataJson?: MetadataJson
}

export interface UpdatePermissionRequestInput {
  status?: PermissionStatus
  resolvedAt?: string | null
  expiresAt?: string | null
  metadataJson?: MetadataJson
}

export interface ListPermissionRequestsFilter {
  conversationId?: string
  runId?: string
  status?: PermissionStatus
  agentId?: string
  limit?: number
  offset?: number
  order?: SortOrder
}

function toOutput(record: Record<string, unknown>) {
  return {
    ...record,
    metadataJson: JSON.parse((record.metadataJson as string) || '{}'),
  }
}

export async function createPermissionRequest(input: CreatePermissionRequestInput) {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  const record = await db.permissionRequest.create({
    data: {
      id: generateId('pr'),
      conversationId: input.conversationId,
      runId: input.runId,
      agentId: input.agentId,
      messageId: input.messageId ?? null,
      permissionType: input.permissionType,
      target: input.target,
      description: input.description,
      status: input.status ?? 'pending',
      expiresAt: input.expiresAt ?? null,
      metadataJson: JSON.stringify(input.metadataJson ?? {}),
      createdAt: now,
      updatedAt: now,
    },
  })
  return toOutput(record as Record<string, unknown>)
}

export async function findPermissionRequestById(id: string) {
  const db = getPrismaClient()
  const record = await db.permissionRequest.findUnique({ where: { id } })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function listPermissionRequests(filter: ListPermissionRequestsFilter = {}) {
  const db = getPrismaClient()
  const { conversationId, runId, status, agentId, limit = 50, offset = 0, order = 'desc' } = filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {}
  if (conversationId) where.conversationId = conversationId
  if (runId) where.runId = runId
  if (status) where.status = status
  if (agentId) where.agentId = agentId

  const records = await db.permissionRequest.findMany({
    where,
    orderBy: { createdAt: order },
    take: limit,
    skip: offset,
  })
  return records.map(r => toOutput(r as Record<string, unknown>))
}

export async function updatePermissionRequest(id: string, input: UpdatePermissionRequestInput) {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { updatedAt: now }
  if (input.status !== undefined) data.status = input.status
  if (input.resolvedAt !== undefined) data.resolvedAt = input.resolvedAt
  if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt
  if (input.metadataJson !== undefined) data.metadataJson = JSON.stringify(input.metadataJson)

  const record = await db.permissionRequest.update({ where: { id }, data })
  return toOutput(record as Record<string, unknown>)
}

export async function deletePermissionRequestById(id: string) {
  const db = getPrismaClient()
  await db.permissionRequest.delete({ where: { id } })
}