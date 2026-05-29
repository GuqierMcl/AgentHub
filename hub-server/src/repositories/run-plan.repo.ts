import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import { safeJsonParse } from '../lib/utils'
import {
  listRunPlanTasksByPlan,
  type RunPlanTaskOutput,
} from './run-plan-task.repo'

export interface CreateRunPlanInput {
  id?: string
  runId: string
  conversationId: string
  sourceEventId?: string | null
  revision?: number
  entryAgentId?: string | null
  intent?: string | null
  summaryInstruction?: string | null
  state?: string
  payloadJson?: Record<string, unknown>
  firstEventSequence?: number | null
  lastEventSequence?: number | null
  completedAt?: string | null
}

export interface UpdateRunPlanInput {
  sourceEventId?: string | null
  revision?: number
  entryAgentId?: string | null
  intent?: string | null
  summaryInstruction?: string | null
  state?: string
  payloadJson?: Record<string, unknown>
  firstEventSequence?: number | null
  lastEventSequence?: number | null
  completedAt?: string | null
}

export interface RunPlanOutput {
  id: string
  runId: string
  conversationId: string
  sourceEventId: string | null
  revision: number
  entryAgentId: string | null
  intent: string | null
  summaryInstruction: string | null
  state: string
  payloadJson: Record<string, unknown>
  firstEventSequence: number | null
  lastEventSequence: number | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  tasks?: RunPlanTaskOutput[]
}

function parseRecord(record: Record<string, unknown>): RunPlanOutput {
  return {
    ...record,
      payloadJson: safeJsonParse(record.payloadJson as string | undefined, {}),
    completedAt: record.completedAt as string | null,
  } as RunPlanOutput
}

export async function createRunPlan(input: CreateRunPlanInput): Promise<RunPlanOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  const record = await db.runPlan.create({
    data: {
      id: input.id ?? generateId('rpl'),
      runId: input.runId,
      conversationId: input.conversationId,
      sourceEventId: input.sourceEventId ?? null,
      revision: input.revision ?? 0,
      entryAgentId: input.entryAgentId ?? null,
      intent: input.intent ?? null,
      summaryInstruction: input.summaryInstruction ?? null,
      state: input.state ?? 'completed',
      payloadJson: JSON.stringify(input.payloadJson ?? {}),
      firstEventSequence: input.firstEventSequence ?? null,
      lastEventSequence: input.lastEventSequence ?? null,
      completedAt: input.completedAt ?? null,
      createdAt: now,
      updatedAt: now,
    },
  })
  return parseRecord(record as Record<string, unknown>)
}

export async function findRunPlanById(id: string): Promise<RunPlanOutput | null> {
  const db = getPrismaClient()
  const record = await db.runPlan.findUnique({ where: { id } })
  if (!record) return null
  const plan = parseRecord(record as Record<string, unknown>)
  const tasks = await listRunPlanTasksByPlan(id)
  return { ...plan, tasks }
}

export async function findRunPlanByRunAndSourceEvent(
  runId: string,
  sourceEventId: string,
): Promise<RunPlanOutput | null> {
  const db = getPrismaClient()
  const record = await db.runPlan.findFirst({
    where: {
      runId,
      sourceEventId,
    },
  })
  if (!record) return null
  return findRunPlanById((record as Record<string, unknown>).id as string)
}

export async function listRunPlansByRun(runId: string): Promise<RunPlanOutput[]> {
  const db = getPrismaClient()
  const records = await db.runPlan.findMany({
    where: { runId },
    orderBy: [{ firstEventSequence: 'asc' }, { createdAt: 'asc' }],
  })
  const plans = records.map((record) => parseRecord(record as Record<string, unknown>))
  return Promise.all(plans.map(async (plan) => ({
    ...plan,
    tasks: await listRunPlanTasksByPlan(plan.id),
  })))
}

export async function listRunPlansByConversation(conversationId: string): Promise<RunPlanOutput[]> {
  const db = getPrismaClient()
  const records = await db.runPlan.findMany({
    where: { conversationId },
    orderBy: [{ firstEventSequence: 'asc' }, { createdAt: 'asc' }],
  })
  const plans = records.map((record) => parseRecord(record as Record<string, unknown>))
  return Promise.all(plans.map(async (plan) => ({
    ...plan,
    tasks: await listRunPlanTasksByPlan(plan.id),
  })))
}

export async function findLatestRunPlanByRun(runId: string): Promise<RunPlanOutput | null> {
  const db = getPrismaClient()
  const record = await db.runPlan.findFirst({
    where: { runId },
    orderBy: [{ firstEventSequence: 'desc' }, { createdAt: 'desc' }],
  })
  if (!record) return null
  return findRunPlanById((record as Record<string, unknown>).id as string)
}

export async function findLatestRunPlanByConversation(conversationId: string): Promise<RunPlanOutput | null> {
  const db = getPrismaClient()
  const record = await db.runPlan.findFirst({
    where: {
      run: {
        conversationId,
      },
    },
    orderBy: [{ firstEventSequence: 'desc' }, { createdAt: 'desc' }],
  })
  if (!record) return null
  return findRunPlanById((record as Record<string, unknown>).id as string)
}

export async function updateRunPlan(id: string, input: UpdateRunPlanInput): Promise<RunPlanOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { updatedAt: now }
  if (input.sourceEventId !== undefined) data.sourceEventId = input.sourceEventId
  if (input.revision !== undefined) data.revision = input.revision
  if (input.entryAgentId !== undefined) data.entryAgentId = input.entryAgentId
  if (input.intent !== undefined) data.intent = input.intent
  if (input.summaryInstruction !== undefined) data.summaryInstruction = input.summaryInstruction
  if (input.state !== undefined) data.state = input.state
  if (input.payloadJson !== undefined) data.payloadJson = JSON.stringify(input.payloadJson)
  if (input.firstEventSequence !== undefined) data.firstEventSequence = input.firstEventSequence
  if (input.lastEventSequence !== undefined) data.lastEventSequence = input.lastEventSequence
  if (input.completedAt !== undefined) data.completedAt = input.completedAt

  const record = await db.runPlan.update({ where: { id }, data })
  return parseRecord(record as Record<string, unknown>)
}
