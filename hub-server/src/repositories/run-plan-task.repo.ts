import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import { safeJsonParse } from '../lib/utils'

export interface CreateRunPlanTaskInput {
  id?: string
  planId: string
  conversationId: string
  taskId: string
  targetAgentId?: string | null
  title?: string | null
  instruction?: string | null
  expectedOutput?: string | null
  state?: string
  riskLevel?: string | null
  dependsOnJson?: string[] | null
  payloadJson?: Record<string, unknown>
  firstEventSequence?: number | null
  lastEventSequence?: number | null
  sortOrder?: number
}

export interface UpdateRunPlanTaskInput {
  targetAgentId?: string | null
  title?: string | null
  instruction?: string | null
  expectedOutput?: string | null
  state?: string
  riskLevel?: string | null
  dependsOnJson?: string[] | null
  payloadJson?: Record<string, unknown>
  firstEventSequence?: number | null
  lastEventSequence?: number | null
  sortOrder?: number
}

export interface RunPlanTaskOutput {
  id: string
  planId: string
  conversationId: string
  taskId: string
  targetAgentId: string | null
  title: string | null
  instruction: string | null
  expectedOutput: string | null
  state: string
  riskLevel: string | null
  dependsOnJson: string[]
  payloadJson: Record<string, unknown>
  firstEventSequence: number | null
  lastEventSequence: number | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

function toOutput(record: Record<string, unknown>): RunPlanTaskOutput {
  return {
    ...record,
    dependsOnJson: safeJsonParse(record.dependsOnJson as string | undefined, []),
    payloadJson: safeJsonParse(record.payloadJson as string | undefined, {}),
  } as unknown as RunPlanTaskOutput
}

export async function createRunPlanTask(input: CreateRunPlanTaskInput): Promise<RunPlanTaskOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  const record = await db.runPlanTask.create({
    data: {
      id: input.id ?? generateId('rpt'),
      planId: input.planId,
      conversationId: input.conversationId,
      taskId: input.taskId,
      targetAgentId: input.targetAgentId ?? null,
      title: input.title ?? null,
      instruction: input.instruction ?? null,
      expectedOutput: input.expectedOutput ?? null,
      state: input.state ?? 'pending',
      riskLevel: input.riskLevel ?? null,
      dependsOnJson: JSON.stringify(input.dependsOnJson ?? []),
      payloadJson: JSON.stringify(input.payloadJson ?? {}),
      firstEventSequence: input.firstEventSequence ?? null,
      lastEventSequence: input.lastEventSequence ?? null,
      sortOrder: input.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    },
  })
  return toOutput(record as Record<string, unknown>)
}

export async function findRunPlanTaskByPlanAndTaskId(
  planId: string,
  taskId: string,
): Promise<RunPlanTaskOutput | null> {
  const db = getPrismaClient()
  const record = await db.runPlanTask.findFirst({
    where: {
      planId,
      taskId,
    },
  })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function listRunPlanTasksByPlan(planId: string): Promise<RunPlanTaskOutput[]> {
  const db = getPrismaClient()
  const records = await db.runPlanTask.findMany({
    where: { planId },
    orderBy: { sortOrder: 'asc' },
  })
  return records.map((record) => toOutput(record as Record<string, unknown>))
}

export async function listRunPlanTasksByConversation(conversationId: string): Promise<RunPlanTaskOutput[]> {
  const db = getPrismaClient()
  const records = await db.runPlanTask.findMany({
    where: { conversationId },
    orderBy: { sortOrder: 'asc' },
  })
  return records.map((record) => toOutput(record as Record<string, unknown>))
}

export async function updateRunPlanTask(
  id: string,
  input: UpdateRunPlanTaskInput,
): Promise<RunPlanTaskOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { updatedAt: now }
  if (input.targetAgentId !== undefined) data.targetAgentId = input.targetAgentId
  if (input.title !== undefined) data.title = input.title
  if (input.instruction !== undefined) data.instruction = input.instruction
  if (input.expectedOutput !== undefined) data.expectedOutput = input.expectedOutput
  if (input.state !== undefined) data.state = input.state
  if (input.riskLevel !== undefined) data.riskLevel = input.riskLevel
  if (input.dependsOnJson !== undefined) data.dependsOnJson = JSON.stringify(input.dependsOnJson)
  if (input.payloadJson !== undefined) data.payloadJson = JSON.stringify(input.payloadJson)
  if (input.firstEventSequence !== undefined) data.firstEventSequence = input.firstEventSequence
  if (input.lastEventSequence !== undefined) data.lastEventSequence = input.lastEventSequence
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder

  const record = await db.runPlanTask.update({ where: { id }, data })
  return toOutput(record as Record<string, unknown>)
}
