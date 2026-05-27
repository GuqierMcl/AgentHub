import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import type { AgentRole } from '../lib/types'

export interface CreateConversationAgentInput {
  conversationId: string
  agentId: string
  role: AgentRole
  sortOrder?: number
}

export interface UpdateConversationAgentInput {
  role?: AgentRole
  sortOrder?: number
}

export async function createConversationAgent(input: CreateConversationAgentInput) {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  return db.conversationAgent.create({
    data: {
      id: generateId('conv'),
      conversationId: input.conversationId,
      agentId: input.agentId,
      role: input.role,
      joinedAt: now,
      sortOrder: input.sortOrder ?? 0,
    },
  })
}

export async function findConversationAgent(conversationId: string, agentId: string) {
  const db = getPrismaClient()
  return db.conversationAgent.findUnique({
    where: { conversationId_agentId: { conversationId, agentId } },
  })
}

export async function listConversationAgents(conversationId: string) {
  const db = getPrismaClient()
  return db.conversationAgent.findMany({
    where: { conversationId },
    orderBy: { sortOrder: 'asc' },
  })
}

export async function updateConversationAgent(conversationId: string, agentId: string, input: UpdateConversationAgentInput) {
  const db = getPrismaClient()
  return db.conversationAgent.update({
    where: { conversationId_agentId: { conversationId, agentId } },
    data: { ...input },
  })
}

export async function deleteConversationAgent(conversationId: string, agentId: string) {
  const db = getPrismaClient()
  return db.conversationAgent.delete({
    where: { conversationId_agentId: { conversationId, agentId } },
  })
}

export async function findConversationAgentsByAgentId(agentId: string) {
  const db = getPrismaClient()
  return db.conversationAgent.findMany({
    where: { agentId },
    select: { conversationId: true },
  })
}

export async function deleteConversationAgentsByConversationId(conversationId: string) {
  const db = getPrismaClient()
  return db.conversationAgent.deleteMany({ where: { conversationId } })
}