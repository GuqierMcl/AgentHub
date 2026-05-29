import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import { safeJsonParse } from '../lib/utils'
import type { PermissionType, PermissionStatus, MetadataJson, SortOrder } from '../lib/types'

export interface CreatePermissionRequestInput {
  conversationId: string
  runId: string
  agentId: string
  runtimeRequestId?: string | null
  messageId?: string | null
  messageIndex?: number | null
  parentAgentId?: string | null
  taskId?: string | null
  groupId?: string | null
  parentTaskId?: string | null
  toolCallId?: string | null
  toolName?: string | null
  riskLevel?: string | null
  permissionType: PermissionType
  target: string
  description: string
  status?: PermissionStatus
  expiresAt?: string | null
  reason?: string | null
  decisionReason?: string | null
  grantJson?: Record<string, unknown> | null
  dataJson?: Record<string, unknown> | null
  payloadJson?: Record<string, unknown>
  metadataJson?: MetadataJson
  firstEventSequence?: number | null
  lastEventSequence?: number | null
}

export interface UpdatePermissionRequestInput {
  status?: PermissionStatus
  resolvedAt?: string | null
  expiresAt?: string | null
  reason?: string | null
  decisionReason?: string | null
  grantJson?: Record<string, unknown> | null
  dataJson?: Record<string, unknown> | null
  payloadJson?: Record<string, unknown>
  firstEventSequence?: number | null
  lastEventSequence?: number | null
  metadataJson?: MetadataJson
}

export interface PermissionRequestOutput {
  id: string
  conversationId: string
  runId: string
  agentId: string
  runtimeRequestId: string | null
  messageId: string | null
  messageIndex: number | null
  parentAgentId: string | null
  taskId: string | null
  groupId: string | null
  parentTaskId: string | null
  toolCallId: string | null
  toolName: string | null
  riskLevel: string | null
  permissionType: PermissionType
  target: string
  description: string
  status: PermissionStatus
  resolvedAt: string | null
  expiresAt: string | null
  reason: string | null
  decisionReason: string | null
  grantJson: Record<string, unknown> | null
  dataJson: Record<string, unknown> | null
  payloadJson: Record<string, unknown>
  firstEventSequence: number | null
  lastEventSequence: number | null
  metadataJson: MetadataJson
  createdAt: string
  updatedAt: string
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

function toOutput(record: Record<string, unknown>): PermissionRequestOutput {
  return {
    ...record,
    metadataJson: safeJsonParse(record.metadataJson as string | undefined, {}),
    grantJson: safeJsonParse(record.grantJson as string | undefined, null),
    dataJson: safeJsonParse(record.dataJson as string | undefined, null),
    payloadJson: safeJsonParse(record.payloadJson as string | undefined, {}),
  } as PermissionRequestOutput
}

export async function createPermissionRequest(input: CreatePermissionRequestInput): Promise<PermissionRequestOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  const record = await db.permissionRequest.create({
    data: {
      id: generateId('pr'),
      conversationId: input.conversationId,
      runId: input.runId,
      agentId: input.agentId,
      runtimeRequestId: input.runtimeRequestId ?? null,
      messageId: input.messageId ?? null,
      messageIndex: input.messageIndex ?? null,
      parentAgentId: input.parentAgentId ?? null,
      taskId: input.taskId ?? null,
      groupId: input.groupId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      toolCallId: input.toolCallId ?? null,
      toolName: input.toolName ?? null,
      riskLevel: input.riskLevel ?? null,
      permissionType: input.permissionType,
      target: input.target,
      description: input.description,
      status: input.status ?? 'pending',
      expiresAt: input.expiresAt ?? null,
      reason: input.reason ?? null,
      decisionReason: input.decisionReason ?? null,
      grantJson: input.grantJson ? JSON.stringify(input.grantJson) : null,
      dataJson: input.dataJson ? JSON.stringify(input.dataJson) : null,
      payloadJson: JSON.stringify(input.payloadJson ?? {}),
      firstEventSequence: input.firstEventSequence ?? null,
      lastEventSequence: input.lastEventSequence ?? null,
      metadataJson: JSON.stringify(input.metadataJson ?? {}),
      createdAt: now,
      updatedAt: now,
    },
  })
  return toOutput(record as Record<string, unknown>)
}

export async function findPermissionRequestById(id: string): Promise<PermissionRequestOutput | null> {
  const db = getPrismaClient()
  const record = await db.permissionRequest.findUnique({ where: { id } })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function findPermissionRequestByRunAndRuntimeRequestId(
  runId: string,
  runtimeRequestId: string,
): Promise<PermissionRequestOutput | null> {
  const db = getPrismaClient()
  const record = await db.permissionRequest.findFirst({
    where: {
      runId,
      runtimeRequestId,
    },
  })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function listPermissionRequests(
  filter: ListPermissionRequestsFilter = {},
): Promise<PermissionRequestOutput[]> {
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

export async function listPermissionRequestsByConversation(
  conversationId: string,
): Promise<PermissionRequestOutput[]> {
  const db = getPrismaClient()
  const records = await db.permissionRequest.findMany({
    where: { conversationId },
    orderBy: [{ firstEventSequence: 'asc' }, { createdAt: 'asc' }],
  })
  return records.map(r => toOutput(r as Record<string, unknown>))
}

export async function updatePermissionRequest(
  id: string,
  input: UpdatePermissionRequestInput,
): Promise<PermissionRequestOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { updatedAt: now }
  if (input.status !== undefined) data.status = input.status
  if (input.resolvedAt !== undefined) data.resolvedAt = input.resolvedAt
  if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt
  if (input.reason !== undefined) data.reason = input.reason
  if (input.decisionReason !== undefined) data.decisionReason = input.decisionReason
  if (input.grantJson !== undefined) data.grantJson = input.grantJson ? JSON.stringify(input.grantJson) : null
  if (input.dataJson !== undefined) data.dataJson = input.dataJson ? JSON.stringify(input.dataJson) : null
  if (input.payloadJson !== undefined) data.payloadJson = JSON.stringify(input.payloadJson)
  if (input.firstEventSequence !== undefined) data.firstEventSequence = input.firstEventSequence
  if (input.lastEventSequence !== undefined) data.lastEventSequence = input.lastEventSequence
  if (input.metadataJson !== undefined) data.metadataJson = JSON.stringify(input.metadataJson)

  const record = await db.permissionRequest.update({ where: { id }, data })
  return toOutput(record as Record<string, unknown>)
}

export async function deletePermissionRequestById(id: string): Promise<void> {
  const db = getPrismaClient()
  await db.permissionRequest.delete({ where: { id } })
}
