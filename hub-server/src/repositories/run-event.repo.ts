import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import { safeJsonParse } from '../lib/utils'
import type { PayloadJson } from '../lib/types'

export interface CreateRunEventInput {
  id?: string
  runId: string
  runtimeRunId?: string
  conversationId: string
  agentId?: string
  parentAgentId?: string
  parentTaskId?: string
  taskId?: string
  groupId?: string
  toolCallId?: string
  toolName?: string
  messageId?: string
  messageIndex?: number
  type: string
  sequence: number
  occurredAt?: string
  payloadJson?: PayloadJson
}

export interface RunEventOutput {
  id: string
  runId: string
  runtimeRunId: string | null
  conversationId: string
  agentId: string | null
  parentAgentId: string | null
  parentTaskId: string | null
  taskId: string | null
  groupId: string | null
  toolCallId: string | null
  toolName: string | null
  messageId: string | null
  messageIndex: number | null
  type: string
  sequence: number
  occurredAt: string | null
  payloadJson: PayloadJson
  createdAt: string
}

function toOutput(record: Record<string, unknown>): RunEventOutput {
  return {
    ...record,
    payloadJson: safeJsonParse(record.payloadJson as string | undefined, {}),
  } as RunEventOutput
}

export async function createRunEvent(input: CreateRunEventInput): Promise<RunEventOutput> {
  const db = getPrismaClient()
  const record = await db.runEvent.create({
    data: {
      id: input.id ?? generateId('evt'),
      runId: input.runId,
      runtimeRunId: input.runtimeRunId ?? null,
      conversationId: input.conversationId,
      agentId: input.agentId ?? null,
      parentAgentId: input.parentAgentId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      taskId: input.taskId ?? null,
      groupId: input.groupId ?? null,
      toolCallId: input.toolCallId ?? null,
      toolName: input.toolName ?? null,
      messageId: input.messageId ?? null,
      messageIndex: input.messageIndex ?? null,
      type: input.type,
      sequence: input.sequence,
      occurredAt: input.occurredAt ?? null,
      payloadJson: JSON.stringify(input.payloadJson ?? {}),
      createdAt: new Date().toISOString(),
    },
  })
  return toOutput(record as Record<string, unknown>)
}

export async function findRunEventById(id: string): Promise<RunEventOutput | null> {
  const db = getPrismaClient()
  const record = await db.runEvent.findUnique({ where: { id } })
  if (!record) return null
  return toOutput(record as Record<string, unknown>)
}

export async function findRunEventsByIds(ids: string[]): Promise<RunEventOutput[]> {
  if (!ids.length) return []
  const db = getPrismaClient()
  const records = await db.runEvent.findMany({
    where: { id: { in: ids } },
    orderBy: { sequence: 'asc' },
  })
  return records.map(r => toOutput(r as Record<string, unknown>))
}

export async function listRunEventsByRun(runId: string): Promise<RunEventOutput[]> {
  const db = getPrismaClient()
  const records = await db.runEvent.findMany({
    where: { runId },
    orderBy: { sequence: 'asc' },
  })
  return records.map(r => toOutput(r as Record<string, unknown>))
}

export async function listRunEventsByRunAfterSequence(
  runId: string,
  afterSequence: number,
): Promise<RunEventOutput[]> {
  const db = getPrismaClient()
  const records = await db.runEvent.findMany({
    where: {
      runId,
      sequence: { gt: afterSequence },
    },
    orderBy: { sequence: 'asc' },
  })
  return records.map(r => toOutput(r as Record<string, unknown>))
}

export async function getLastRunEventSequence(runId: string): Promise<number> {
  const db = getPrismaClient()
  const record = await db.runEvent.findFirst({
    where: { runId },
    orderBy: { sequence: 'desc' },
    select: { sequence: true },
  })
  return record?.sequence ?? 0
}

export async function listRunEventsByConversation(conversationId: string, opts?: { limit?: number; offset?: number }): Promise<RunEventOutput[]> {
  const db = getPrismaClient()
  const records = await db.runEvent.findMany({
    where: { conversationId },
    orderBy: { sequence: 'asc' },
    take: opts?.limit ?? 200,
    skip: opts?.offset ?? 0,
  })
  return records.map(r => toOutput(r as Record<string, unknown>))
}

export async function listRunEventsByType(type: string, opts?: { limit?: number; offset?: number }): Promise<RunEventOutput[]> {
  const db = getPrismaClient()
  const records = await db.runEvent.findMany({
    where: { type },
    orderBy: { sequence: 'asc' },
    take: opts?.limit ?? 100,
    skip: opts?.offset ?? 0,
  })
  return records.map(r => toOutput(r as Record<string, unknown>))
}

export async function deleteRunEventsByRun(runId: string) {
  const db = getPrismaClient()
  return db.runEvent.deleteMany({ where: { runId } })
}

export async function createRunEvents(inputs: CreateRunEventInput[]): Promise<RunEventOutput[]> {
  const db = getPrismaClient()
  const now = new Date().toISOString()
  const results = await db.$transaction(
    inputs.map(input =>
      db.runEvent.create({
        data: {
          id: input.id ?? generateId('evt'),
          runId: input.runId,
          runtimeRunId: input.runtimeRunId ?? null,
          conversationId: input.conversationId,
          agentId: input.agentId ?? null,
          parentAgentId: input.parentAgentId ?? null,
          parentTaskId: input.parentTaskId ?? null,
          taskId: input.taskId ?? null,
          groupId: input.groupId ?? null,
          toolCallId: input.toolCallId ?? null,
          toolName: input.toolName ?? null,
          messageId: input.messageId ?? null,
          messageIndex: input.messageIndex ?? null,
          type: input.type,
          sequence: input.sequence,
          occurredAt: input.occurredAt ?? null,
          payloadJson: JSON.stringify(input.payloadJson ?? {}),
          createdAt: now,
        },
      })
    )
  )
  return results.map(r => toOutput(r as Record<string, unknown>))
}
