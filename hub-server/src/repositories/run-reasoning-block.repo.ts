import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import { safeJsonParse } from '../lib/utils'

export interface CreateRunReasoningBlockInput {
  id?: string
  runId: string
  conversationId: string
  reasoningId: string
  agentId?: string | null
  parentAgentId?: string | null
  parentTaskId?: string | null
  taskId?: string | null
  groupId?: string | null
  messageId?: string | null
  messageIndex?: number | null
  content?: string
  state?: string
  payloadJson?: Record<string, unknown>
  firstEventSequence?: number | null
  lastEventSequence?: number | null
  startedAt?: string | null
  completedAt?: string | null
}

export interface UpdateRunReasoningBlockInput {
  agentId?: string | null
  parentAgentId?: string | null
  parentTaskId?: string | null
  taskId?: string | null
  groupId?: string | null
  messageId?: string | null
  messageIndex?: number | null
  content?: string
  state?: string
  payloadJson?: Record<string, unknown>
  firstEventSequence?: number | null
  lastEventSequence?: number | null
  startedAt?: string | null
  completedAt?: string | null
}

export interface RunReasoningBlockOutput {
  id: string
  runId: string
  conversationId: string
  reasoningId: string
  agentId: string | null
  parentAgentId: string | null
  parentTaskId: string | null
  taskId: string | null
  groupId: string | null
  messageId: string | null
  messageIndex: number | null
  content: string
  state: string
  payloadJson: Record<string, unknown>
  firstEventSequence: number | null
  lastEventSequence: number | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

function toOutput(record: Record<string, unknown>): RunReasoningBlockOutput {
  return {
    ...record,
    payloadJson: safeJsonParse(record.payloadJson as string | undefined, {}),
  } as RunReasoningBlockOutput
}

export async function createRunReasoningBlock(
  input: CreateRunReasoningBlockInput,
): Promise<RunReasoningBlockOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  const record = await db.runReasoningBlock.create({
    data: {
      id: input.id ?? generateId('rrb'),
      runId: input.runId,
      conversationId: input.conversationId,
      reasoningId: input.reasoningId,
      agentId: input.agentId ?? null,
      parentAgentId: input.parentAgentId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      taskId: input.taskId ?? null,
      groupId: input.groupId ?? null,
      messageId: input.messageId ?? null,
      messageIndex: input.messageIndex ?? null,
      content: input.content ?? '',
      state: input.state ?? 'streaming',
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

export async function findRunReasoningBlockById(id: string): Promise<RunReasoningBlockOutput | null> {
  const db = getPrismaClient()
  const record = await db.runReasoningBlock.findUnique({ where: { id } })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function findRunReasoningBlockByRunAndReasoning(
  runId: string,
  reasoningId: string,
): Promise<RunReasoningBlockOutput | null> {
  const db = getPrismaClient()
  const record = await db.runReasoningBlock.findFirst({
    where: {
      runId,
      reasoningId,
    },
  })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function listRunReasoningBlocksByRun(runId: string): Promise<RunReasoningBlockOutput[]> {
  const db = getPrismaClient()
  const records = await db.runReasoningBlock.findMany({
    where: { runId },
    orderBy: [{ firstEventSequence: 'asc' }, { createdAt: 'asc' }],
  })
  return records.map((record) => toOutput(record as Record<string, unknown>))
}

export async function listRunReasoningBlocksByConversation(conversationId: string): Promise<RunReasoningBlockOutput[]> {
  const db = getPrismaClient()
  const records = await db.runReasoningBlock.findMany({
    where: { conversationId },
    orderBy: [{ firstEventSequence: 'asc' }, { createdAt: 'asc' }],
  })
  return records.map((record) => toOutput(record as Record<string, unknown>))
}

export async function updateRunReasoningBlock(
  id: string,
  input: UpdateRunReasoningBlockInput,
): Promise<RunReasoningBlockOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { updatedAt: now }
  if (input.agentId !== undefined) data.agentId = input.agentId
  if (input.parentAgentId !== undefined) data.parentAgentId = input.parentAgentId
  if (input.parentTaskId !== undefined) data.parentTaskId = input.parentTaskId
  if (input.taskId !== undefined) data.taskId = input.taskId
  if (input.groupId !== undefined) data.groupId = input.groupId
  if (input.messageId !== undefined) data.messageId = input.messageId
  if (input.messageIndex !== undefined) data.messageIndex = input.messageIndex
  if (input.content !== undefined) data.content = input.content
  if (input.state !== undefined) data.state = input.state
  if (input.payloadJson !== undefined) data.payloadJson = JSON.stringify(input.payloadJson)
  if (input.firstEventSequence !== undefined) data.firstEventSequence = input.firstEventSequence
  if (input.lastEventSequence !== undefined) data.lastEventSequence = input.lastEventSequence
  if (input.startedAt !== undefined) data.startedAt = input.startedAt
  if (input.completedAt !== undefined) data.completedAt = input.completedAt

  const record = await db.runReasoningBlock.update({ where: { id }, data })
  return toOutput(record as Record<string, unknown>)
}
