import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import type { RunMode, RunStatus, InputJson, PlanJson, ErrorJson, SortOrder } from '../lib/types'

export interface CreateRunInput {
  conversationId: string
  triggerMessageId: string
  mode: RunMode
  status?: RunStatus
  runtimeId?: string
  orchestratorAgentId?: string
  inputJson?: InputJson
  planJson?: PlanJson
}

export interface UpdateRunInput {
  status?: RunStatus
  runtimeId?: string
  orchestratorAgentId?: string | null
  inputJson?: InputJson
  planJson?: PlanJson | null
  errorJson?: ErrorJson | null
  startedAt?: string | null
  completedAt?: string | null
}

export interface ListRunsFilter {
  conversationId?: string
  status?: RunStatus
  limit?: number
  offset?: number
  order?: SortOrder
}

function toOutput(record: Record<string, unknown>) {
  return {
    ...record,
    inputJson: JSON.parse((record.inputJson as string) || '{}'),
    planJson: record.planJson ? JSON.parse(record.planJson as string) : null,
    errorJson: record.errorJson ? JSON.parse(record.errorJson as string) : null,
  }
}

export async function createRun(input: CreateRunInput) {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  const record = await db.run.create({
    data: {
      id: generateId('run'),
      conversationId: input.conversationId,
      triggerMessageId: input.triggerMessageId,
      mode: input.mode,
      status: input.status ?? 'queued',
      runtimeId: input.runtimeId ?? null,
      orchestratorAgentId: input.orchestratorAgentId ?? null,
      inputJson: JSON.stringify(input.inputJson ?? {}),
      planJson: input.planJson ? JSON.stringify(input.planJson) : null,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  })
  return toOutput(record as Record<string, unknown>)
}

export async function findRunById(id: string) {
  const db = getPrismaClient()
  const record = await db.run.findUnique({ where: { id } })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function listRuns(filter: ListRunsFilter = {}) {
  const db = getPrismaClient()
  const { conversationId, status, limit = 50, offset = 0, order = 'desc' } = filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {}
  if (conversationId) where.conversationId = conversationId
  if (status) where.status = status

  const records = await db.run.findMany({
    where,
    orderBy: { createdAt: order },
    take: limit,
    skip: offset,
  })
  return records.map(r => toOutput(r as Record<string, unknown>))
}

export async function updateRun(id: string, input: UpdateRunInput) {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { updatedAt: now }
  if (input.status !== undefined) data.status = input.status
  if (input.runtimeId !== undefined) data.runtimeId = input.runtimeId
  if (input.orchestratorAgentId !== undefined) data.orchestratorAgentId = input.orchestratorAgentId
  if (input.inputJson !== undefined) data.inputJson = JSON.stringify(input.inputJson)
  if (input.planJson !== undefined) data.planJson = input.planJson ? JSON.stringify(input.planJson) : null
  if (input.errorJson !== undefined) data.errorJson = input.errorJson ? JSON.stringify(input.errorJson) : null
  if (input.startedAt !== undefined) data.startedAt = input.startedAt
  if (input.completedAt !== undefined) data.completedAt = input.completedAt

  const record = await db.run.update({ where: { id }, data })
  return toOutput(record as Record<string, unknown>)
}

export async function deleteRunById(id: string) {
  const db = getPrismaClient()
  await db.run.delete({ where: { id } })
}

export async function countRuns(filter: { conversationId?: string; status?: RunStatus } = {}): Promise<number> {
  const db = getPrismaClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {}
  if (filter.conversationId) where.conversationId = filter.conversationId
  if (filter.status) where.status = filter.status
  return db.run.count({ where })
}

export async function findRunWithEvents(id: string) {
  const db = getPrismaClient()
  const record = await db.run.findUnique({
    where: { id },
    include: { events: { orderBy: { sequence: 'asc' } } },
  })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}