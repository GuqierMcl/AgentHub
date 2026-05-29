import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import { safeJsonParse } from '../lib/utils'

export interface CreateRunToolCallInput {
  id?: string
  runId: string
  conversationId: string
  toolCallId: string
  agentId?: string | null
  parentAgentId?: string | null
  parentTaskId?: string | null
  taskId?: string | null
  groupId?: string | null
  messageId?: string | null
  messageIndex?: number | null
  toolName: string
  displayPolicy?: string
  state?: string
  riskLevel?: string | null
  summary?: string | null
  inputJson?: Record<string, unknown> | null
  outputJson?: Record<string, unknown> | null
  errorJson?: Record<string, unknown> | null
  payloadJson?: Record<string, unknown>
  firstEventSequence?: number | null
  lastEventSequence?: number | null
  startedAt?: string | null
  completedAt?: string | null
}

export interface UpdateRunToolCallInput {
  agentId?: string | null
  parentAgentId?: string | null
  parentTaskId?: string | null
  taskId?: string | null
  groupId?: string | null
  messageId?: string | null
  messageIndex?: number | null
  toolName?: string
  displayPolicy?: string
  state?: string
  riskLevel?: string | null
  summary?: string | null
  inputJson?: Record<string, unknown> | null
  outputJson?: Record<string, unknown> | null
  errorJson?: Record<string, unknown> | null
  payloadJson?: Record<string, unknown>
  firstEventSequence?: number | null
  lastEventSequence?: number | null
  startedAt?: string | null
  completedAt?: string | null
}

export interface RunToolCallOutput {
  id: string
  runId: string
  conversationId: string
  toolCallId: string
  agentId: string | null
  parentAgentId: string | null
  parentTaskId: string | null
  taskId: string | null
  groupId: string | null
  messageId: string | null
  messageIndex: number | null
  toolName: string
  displayPolicy: string
  state: string
  riskLevel: string | null
  summary: string | null
  inputJson: Record<string, unknown> | null
  outputJson: Record<string, unknown> | null
  errorJson: Record<string, unknown> | null
  payloadJson: Record<string, unknown>
  firstEventSequence: number | null
  lastEventSequence: number | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

function toOutput(record: Record<string, unknown>): RunToolCallOutput {
  return {
    ...record,
    inputJson: safeJsonParse(record.inputJson as string | undefined, null),
    outputJson: safeJsonParse(record.outputJson as string | undefined, null),
    errorJson: safeJsonParse(record.errorJson as string | undefined, null),
    payloadJson: safeJsonParse(record.payloadJson as string | undefined, {}),
  } as RunToolCallOutput
}

export async function createRunToolCall(input: CreateRunToolCallInput): Promise<RunToolCallOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  const record = await db.runToolCall.create({
    data: {
      id: input.id ?? generateId('rtc'),
      runId: input.runId,
      conversationId: input.conversationId,
      toolCallId: input.toolCallId,
      agentId: input.agentId ?? null,
      parentAgentId: input.parentAgentId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      taskId: input.taskId ?? null,
      groupId: input.groupId ?? null,
      messageId: input.messageId ?? null,
      messageIndex: input.messageIndex ?? null,
      toolName: input.toolName,
      displayPolicy: input.displayPolicy ?? 'timeline',
      state: input.state ?? 'input-available',
      riskLevel: input.riskLevel ?? null,
      summary: input.summary ?? null,
      inputJson: input.inputJson ? JSON.stringify(input.inputJson) : null,
      outputJson: input.outputJson ? JSON.stringify(input.outputJson) : null,
      errorJson: input.errorJson ? JSON.stringify(input.errorJson) : null,
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

export async function findRunToolCallById(id: string): Promise<RunToolCallOutput | null> {
  const db = getPrismaClient()
  const record = await db.runToolCall.findUnique({ where: { id } })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function findRunToolCallByRunAndToolCall(
  runId: string,
  toolCallId: string,
): Promise<RunToolCallOutput | null> {
  const db = getPrismaClient()
  const record = await db.runToolCall.findFirst({
    where: {
      runId,
      toolCallId,
    },
  })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function listRunToolCallsByRun(runId: string): Promise<RunToolCallOutput[]> {
  const db = getPrismaClient()
  const records = await db.runToolCall.findMany({
    where: { runId },
    orderBy: [{ firstEventSequence: 'asc' }, { createdAt: 'asc' }],
  })
  return records.map((record) => toOutput(record as Record<string, unknown>))
}

export async function listRunToolCallsByConversation(conversationId: string): Promise<RunToolCallOutput[]> {
  const db = getPrismaClient()
  const records = await db.runToolCall.findMany({
    where: { conversationId },
    orderBy: [{ firstEventSequence: 'asc' }, { createdAt: 'asc' }],
  })
  return records.map((record) => toOutput(record as Record<string, unknown>))
}

export async function updateRunToolCall(
  id: string,
  input: UpdateRunToolCallInput,
): Promise<RunToolCallOutput> {
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
  if (input.toolName !== undefined) data.toolName = input.toolName
  if (input.displayPolicy !== undefined) data.displayPolicy = input.displayPolicy
  if (input.state !== undefined) data.state = input.state
  if (input.riskLevel !== undefined) data.riskLevel = input.riskLevel
  if (input.summary !== undefined) data.summary = input.summary
  if (input.inputJson !== undefined) data.inputJson = input.inputJson ? JSON.stringify(input.inputJson) : null
  if (input.outputJson !== undefined) data.outputJson = input.outputJson ? JSON.stringify(input.outputJson) : null
  if (input.errorJson !== undefined) data.errorJson = input.errorJson ? JSON.stringify(input.errorJson) : null
  if (input.payloadJson !== undefined) data.payloadJson = JSON.stringify(input.payloadJson)
  if (input.firstEventSequence !== undefined) data.firstEventSequence = input.firstEventSequence
  if (input.lastEventSequence !== undefined) data.lastEventSequence = input.lastEventSequence
  if (input.startedAt !== undefined) data.startedAt = input.startedAt
  if (input.completedAt !== undefined) data.completedAt = input.completedAt

  const record = await db.runToolCall.update({ where: { id }, data })
  return toOutput(record as Record<string, unknown>)
}
