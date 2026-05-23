import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import type { PayloadJson } from '../lib/types'

export interface CreateRunEventInput {
  runId: string
  conversationId: string
  agentId?: string
  messageId?: string
  type: string
  sequence: number
  payloadJson?: PayloadJson
}

export interface RunEventOutput {
  id: string
  runId: string
  conversationId: string
  agentId: string | null
  messageId: string | null
  type: string
  sequence: number
  payloadJson: PayloadJson
  createdAt: string
}

function toOutput(record: Record<string, unknown>): RunEventOutput {
  return {
    ...record,
    payloadJson: JSON.parse((record.payloadJson as string) || '{}'),
  } as RunEventOutput
}

export async function createRunEvent(input: CreateRunEventInput): Promise<RunEventOutput> {
  const db = getPrismaClient()
  const record = await db.runEvent.create({
    data: {
      id: generateId('evt'),
      runId: input.runId,
      conversationId: input.conversationId,
      agentId: input.agentId ?? null,
      messageId: input.messageId ?? null,
      type: input.type,
      sequence: input.sequence,
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

export async function listRunEventsByRun(runId: string): Promise<RunEventOutput[]> {
  const db = getPrismaClient()
  const records = await db.runEvent.findMany({
    where: { runId },
    orderBy: { sequence: 'asc' },
  })
  return records.map(r => toOutput(r as Record<string, unknown>))
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
          id: generateId('evt'),
          runId: input.runId,
          conversationId: input.conversationId,
          agentId: input.agentId ?? null,
          messageId: input.messageId ?? null,
          type: input.type,
          sequence: input.sequence,
          payloadJson: JSON.stringify(input.payloadJson ?? {}),
          createdAt: now,
        },
      })
    )
  )
  return results.map(r => toOutput(r as Record<string, unknown>))
}