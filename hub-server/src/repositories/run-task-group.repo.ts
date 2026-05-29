import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import { safeJsonParse } from '../lib/utils'

export interface CreateRunTaskGroupInput {
  id?: string
  runId: string
  conversationId: string
  groupId: string
  agentId?: string | null
  parentAgentId?: string | null
  parentTaskId?: string | null
  title?: string | null
  state?: string
  summary?: string | null
  payloadJson?: Record<string, unknown>
  firstEventSequence?: number | null
  lastEventSequence?: number | null
  startedAt?: string | null
  completedAt?: string | null
}

export interface UpdateRunTaskGroupInput {
  agentId?: string | null
  parentAgentId?: string | null
  parentTaskId?: string | null
  title?: string | null
  state?: string
  summary?: string | null
  payloadJson?: Record<string, unknown>
  firstEventSequence?: number | null
  lastEventSequence?: number | null
  startedAt?: string | null
  completedAt?: string | null
}

export interface RunTaskGroupOutput {
  id: string
  runId: string
  conversationId: string
  groupId: string
  agentId: string | null
  parentAgentId: string | null
  parentTaskId: string | null
  title: string | null
  state: string
  summary: string | null
  payloadJson: Record<string, unknown>
  firstEventSequence: number | null
  lastEventSequence: number | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

function toOutput(record: Record<string, unknown>): RunTaskGroupOutput {
  return {
    ...record,
    payloadJson: safeJsonParse(record.payloadJson as string | undefined, {}),
  } as RunTaskGroupOutput
}

export async function createRunTaskGroup(input: CreateRunTaskGroupInput): Promise<RunTaskGroupOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  const record = await db.runTaskGroup.create({
    data: {
      id: input.id ?? generateId('rtg'),
      runId: input.runId,
      conversationId: input.conversationId,
      groupId: input.groupId,
      agentId: input.agentId ?? null,
      parentAgentId: input.parentAgentId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      title: input.title ?? null,
      state: input.state ?? 'running',
      summary: input.summary ?? null,
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

export async function findRunTaskGroupByRunAndGroupId(
  runId: string,
  groupId: string,
): Promise<RunTaskGroupOutput | null> {
  const db = getPrismaClient()
  const record = await db.runTaskGroup.findFirst({
    where: {
      runId,
      groupId,
    },
  })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function listRunTaskGroupsByRun(runId: string): Promise<RunTaskGroupOutput[]> {
  const db = getPrismaClient()
  const records = await db.runTaskGroup.findMany({
    where: { runId },
    orderBy: [{ firstEventSequence: 'asc' }, { createdAt: 'asc' }],
  })
  return records.map((record) => toOutput(record as Record<string, unknown>))
}

export async function listRunTaskGroupsByConversation(conversationId: string): Promise<RunTaskGroupOutput[]> {
  const db = getPrismaClient()
  const records = await db.runTaskGroup.findMany({
    where: { conversationId },
    orderBy: [{ firstEventSequence: 'asc' }, { createdAt: 'asc' }],
  })
  return records.map((record) => toOutput(record as Record<string, unknown>))
}

export async function updateRunTaskGroup(
  id: string,
  input: UpdateRunTaskGroupInput,
): Promise<RunTaskGroupOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { updatedAt: now }
  if (input.agentId !== undefined) data.agentId = input.agentId
  if (input.parentAgentId !== undefined) data.parentAgentId = input.parentAgentId
  if (input.parentTaskId !== undefined) data.parentTaskId = input.parentTaskId
  if (input.title !== undefined) data.title = input.title
  if (input.state !== undefined) data.state = input.state
  if (input.summary !== undefined) data.summary = input.summary
  if (input.payloadJson !== undefined) data.payloadJson = JSON.stringify(input.payloadJson)
  if (input.firstEventSequence !== undefined) data.firstEventSequence = input.firstEventSequence
  if (input.lastEventSequence !== undefined) data.lastEventSequence = input.lastEventSequence
  if (input.startedAt !== undefined) data.startedAt = input.startedAt
  if (input.completedAt !== undefined) data.completedAt = input.completedAt

  const record = await db.runTaskGroup.update({ where: { id }, data })
  return toOutput(record as Record<string, unknown>)
}
