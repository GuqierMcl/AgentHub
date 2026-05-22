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

export async function createRunEvent(input: CreateRunEventInput) {
  const db = getPrismaClient()
  return db.runEvent.create({
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
}

export async function findRunEventById(id: string) {
  const db = getPrismaClient()
  return db.runEvent.findUnique({ where: { id } })
}

export async function listRunEventsByRun(runId: string) {
  const db = getPrismaClient()
  return db.runEvent.findMany({
    where: { runId },
    orderBy: { sequence: 'asc' },
  })
}

export async function listRunEventsByConversation(conversationId: string, opts?: { limit?: number; offset?: number }) {
  const db = getPrismaClient()
  return db.runEvent.findMany({
    where: { conversationId },
    orderBy: { sequence: 'asc' },
    take: opts?.limit ?? 200,
    skip: opts?.offset ?? 0,
  })
}

export async function listRunEventsByType(type: string, opts?: { limit?: number; offset?: number }) {
  const db = getPrismaClient()
  return db.runEvent.findMany({
    where: { type },
    orderBy: { sequence: 'asc' },
    take: opts?.limit ?? 100,
    skip: opts?.offset ?? 0,
  })
}

export async function deleteRunEventsByRun(runId: string) {
  const db = getPrismaClient()
  return db.runEvent.deleteMany({ where: { runId } })
}

export async function createRunEvents(inputs: CreateRunEventInput[]) {
  const db = getPrismaClient()
  const now = new Date().toISOString()
  return db.$transaction(
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
}