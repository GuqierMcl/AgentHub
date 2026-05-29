import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import { safeJsonParse } from '../lib/utils'

export interface CreateRunTaskInput {
  id?: string
  runId: string
  conversationId: string
  taskId: string
  groupId?: string | null
  agentId?: string | null
  parentAgentId?: string | null
  parentTaskId?: string | null
  targetAgentId?: string | null
  title?: string | null
  instruction?: string | null
  expectedOutput?: string | null
  summary?: string | null
  state?: string
  dependsOnJson?: string[] | null
  payloadJson?: Record<string, unknown>
  firstEventSequence?: number | null
  lastEventSequence?: number | null
  startedAt?: string | null
  completedAt?: string | null
}

export interface UpdateRunTaskInput {
  groupId?: string | null
  agentId?: string | null
  parentAgentId?: string | null
  parentTaskId?: string | null
  targetAgentId?: string | null
  title?: string | null
  instruction?: string | null
  expectedOutput?: string | null
  summary?: string | null
  state?: string
  dependsOnJson?: string[] | null
  payloadJson?: Record<string, unknown>
  firstEventSequence?: number | null
  lastEventSequence?: number | null
  startedAt?: string | null
  completedAt?: string | null
}

export interface RunTaskOutput {
  id: string
  runId: string
  conversationId: string
  taskId: string
  groupId: string | null
  agentId: string | null
  parentAgentId: string | null
  parentTaskId: string | null
  targetAgentId: string | null
  title: string | null
  instruction: string | null
  expectedOutput: string | null
  summary: string | null
  state: string
  dependsOnJson: string[]
  payloadJson: Record<string, unknown>
  firstEventSequence: number | null
  lastEventSequence: number | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

function toOutput(record: Record<string, unknown>): RunTaskOutput {
  return {
    ...record,
    dependsOnJson: safeJsonParse(record.dependsOnJson as string | undefined, []),
    payloadJson: safeJsonParse(record.payloadJson as string | undefined, {}),
  } as unknown as RunTaskOutput
}

export async function createRunTask(input: CreateRunTaskInput): Promise<RunTaskOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  const record = await db.runTask.create({
    data: {
      id: input.id ?? generateId('rt'),
      runId: input.runId,
      conversationId: input.conversationId,
      taskId: input.taskId,
      groupId: input.groupId ?? null,
      agentId: input.agentId ?? null,
      parentAgentId: input.parentAgentId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      targetAgentId: input.targetAgentId ?? null,
      title: input.title ?? null,
      instruction: input.instruction ?? null,
      expectedOutput: input.expectedOutput ?? null,
      summary: input.summary ?? null,
      state: input.state ?? 'pending',
      dependsOnJson: JSON.stringify(input.dependsOnJson ?? []),
      payloadJson: JSON.stringify(input.payloadJson ?? {}),
      firstEventSequence: input.firstEventSequence ?? null,
      lastEventSequence: input.lastEventSequence ?? null,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      createdAt: now,
      updatedAt: now,
    },
  })
  return toOutput(record as Record<string, unknown>)
}

export async function findRunTaskByRunAndTaskId(
  runId: string,
  taskId: string,
): Promise<RunTaskOutput | null> {
  const db = getPrismaClient()
  const record = await db.runTask.findFirst({
    where: {
      runId,
      taskId,
    },
  })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function listRunTasksByRun(runId: string): Promise<RunTaskOutput[]> {
  const db = getPrismaClient()
  const records = await db.runTask.findMany({
    where: { runId },
    orderBy: [{ firstEventSequence: 'asc' }, { createdAt: 'asc' }],
  })
  return records.map((record) => toOutput(record as Record<string, unknown>))
}

export async function listRunTasksByConversation(conversationId: string): Promise<RunTaskOutput[]> {
  const db = getPrismaClient()
  const records = await db.runTask.findMany({
    where: { conversationId },
    orderBy: [{ firstEventSequence: 'asc' }, { createdAt: 'asc' }],
  })
  return records.map((record) => toOutput(record as Record<string, unknown>))
}

export async function updateRunTask(id: string, input: UpdateRunTaskInput): Promise<RunTaskOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { updatedAt: now }
  if (input.groupId !== undefined) data.groupId = input.groupId
  if (input.agentId !== undefined) data.agentId = input.agentId
  if (input.parentAgentId !== undefined) data.parentAgentId = input.parentAgentId
  if (input.parentTaskId !== undefined) data.parentTaskId = input.parentTaskId
  if (input.targetAgentId !== undefined) data.targetAgentId = input.targetAgentId
  if (input.title !== undefined) data.title = input.title
  if (input.instruction !== undefined) data.instruction = input.instruction
  if (input.expectedOutput !== undefined) data.expectedOutput = input.expectedOutput
  if (input.summary !== undefined) data.summary = input.summary
  if (input.state !== undefined) data.state = input.state
  if (input.dependsOnJson !== undefined) data.dependsOnJson = JSON.stringify(input.dependsOnJson)
  if (input.payloadJson !== undefined) data.payloadJson = JSON.stringify(input.payloadJson)
  if (input.firstEventSequence !== undefined) data.firstEventSequence = input.firstEventSequence
  if (input.lastEventSequence !== undefined) data.lastEventSequence = input.lastEventSequence
  if (input.startedAt !== undefined) data.startedAt = input.startedAt
  if (input.completedAt !== undefined) data.completedAt = input.completedAt

  const record = await db.runTask.update({ where: { id }, data })
  return toOutput(record as Record<string, unknown>)
}
