import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import { safeJsonParse } from '../lib/utils'
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
  lastEventSequence?: number
  lastProjectedSequence?: number
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

export interface RunOutput {
  id: string
  conversationId: string
  triggerMessageId: string
  mode: string
  status: RunStatus
  runtimeId: string | null
  orchestratorAgentId: string | null
  inputJson: InputJson
  planJson: PlanJson | null
  errorJson: ErrorJson | null
  lastEventSequence: number
  lastProjectedSequence: number
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

function toOutput(record: Record<string, unknown>): RunOutput {
  return {
    ...record,
    inputJson: safeJsonParse(record.inputJson as string | undefined, {}),
    planJson: safeJsonParse(record.planJson as string | undefined, null),
    errorJson: safeJsonParse(record.errorJson as string | undefined, null),
  } as RunOutput
}

export async function createRun(input: CreateRunInput): Promise<RunOutput> {
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
      lastEventSequence: 0,
      lastProjectedSequence: 0,
      createdAt: now,
      updatedAt: now,
    },
  })
  return toOutput(record as Record<string, unknown>)
}

export async function findRunById(id: string): Promise<RunOutput | null> {
  const db = getPrismaClient()
  const record = await db.run.findUnique({ where: { id } })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function listRuns(filter: ListRunsFilter = {}): Promise<RunOutput[]> {
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

export async function updateRun(id: string, input: UpdateRunInput): Promise<RunOutput> {
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
  if (input.lastEventSequence !== undefined) data.lastEventSequence = input.lastEventSequence
  if (input.lastProjectedSequence !== undefined) data.lastProjectedSequence = input.lastProjectedSequence
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

export async function findLatestRunWithPlan(conversationId: string): Promise<RunOutput | null> {
  const db = getPrismaClient()
  const record = await db.run.findFirst({
    where: {
      conversationId,
      planJson: { not: null },
    },
    orderBy: { updatedAt: 'desc' },
  })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
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
