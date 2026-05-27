import {
  createConversation,
  findConversationById,
  findConversationWithAgents,
  updateConversation,
  deleteConversationById,
  listConversationsWithAgents,
  type ConversationOutput,
  type ConversationDetailOutput,
  type ConversationListOutput,
} from '../repositories/conversation.repo'
import { createConversationAgent } from '../repositories/conversation-agent.repo'
import { badRequest, notFound } from '../lib/errors'
import type {
  ConversationDetail,
  ConversationListItem,
  ConversationAgentItem,
  CreateConversationBody,
  UpdateConversationBody,
} from '../domains/conversation/types'
import type { ConversationMode, ConversationStatus, MetadataJson } from '../lib/types'

export class ConversationService {
  private toListItem(o: ConversationListOutput): ConversationListItem {
    return {
      id: o.id,
      title: o.title,
      mode: o.mode as ConversationMode,
      status: o.status as ConversationStatus,
      orchestratorAgentId: o.orchestratorAgentId,
      lastMessageId: o.lastMessageId,
      lastMessageAt: o.lastMessageAt,
      pinnedAt: o.pinnedAt,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      agents: o.agents.map((a) => ({
        agentId: a.agentId,
        role: a.role as ConversationAgentItem['role'],
      })),
      metadata: o.metadataJson,
    }
  }

  private toDetail(o: ConversationDetailOutput): ConversationDetail {
    return {
      id: o.id,
      title: o.title,
      mode: o.mode as ConversationMode,
      status: o.status as ConversationStatus,
      orchestratorAgentId: o.orchestratorAgentId,
      lastMessageId: o.lastMessageId,
      lastMessageAt: o.lastMessageAt,
      pinnedAt: o.pinnedAt,
      archivedAt: o.archivedAt,
      metadata: o.metadataJson,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      agents: (o.agents ?? []).map((a): ConversationAgentItem => ({
        agentId: a.agentId,
        role: a.role as ConversationAgentItem['role'],
        sortOrder: a.sortOrder,
        joinedAt: a.joinedAt,
      })),
    }
  }

  async createConversationWithAgents(
    input: CreateConversationBody,
  ): Promise<ConversationDetail> {
    if (input.mode === 'group' && (!input.agents || input.agents.length === 0)) {
      throw badRequest('INVALID_MODE_AGENT', 'group 模式下必须至少指定一个 Agent')
    }

    const conv = await createConversation({
      title: input.title,
      mode: input.mode,
      orchestratorAgentId: input.orchestratorAgentId,
      metadataJson: input.metadata as MetadataJson | undefined,
    })

    if (input.agents && input.agents.length > 0) {
      if (input.mode === 'group') {
        let sortOrder = 0

        if (!input.agents.some((a) => a.role === 'orchestrator') && !input.orchestratorAgentId) {
          await createConversationAgent({
            conversationId: conv.id,
            agentId: 'orchestrator',
            role: 'primary',
            sortOrder: sortOrder++,
          })
          await updateConversation(conv.id, {
            orchestratorAgentId: 'orchestrator',
          })
        }

        for (const agent of input.agents) {
          await createConversationAgent({
            conversationId: conv.id,
            agentId: agent.agentId,
            role: 'member',
            sortOrder: sortOrder++,
          })
        }
      } else {
        for (let i = 0; i < input.agents.length; i++) {
          const agent = input.agents[i]
          await createConversationAgent({
            conversationId: conv.id,
            agentId: agent.agentId,
            role: agent.role,
            sortOrder: i,
          })
        }
      }
    }

    const detail = await findConversationWithAgents(conv.id)
    if (!detail) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')
    return this.toDetail(detail)
  }

  async getConversationDetail(
    id: string,
  ): Promise<ConversationDetail> {
    const detail = await findConversationWithAgents(id)
    if (!detail) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')
    return this.toDetail(detail)
  }

  async listConversations(
    status?: 'active' | 'archived',
  ): Promise<ConversationListItem[]> {
    const items = await listConversationsWithAgents(
      status ? { status } : {},
    )

    return items.map((o) => this.toListItem(o))
  }

  async archiveConversation(
    id: string,
  ): Promise<ConversationDetail> {
    const existing = await findConversationById(id)
    if (!existing) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')

    const now = new Date().toISOString()
    await updateConversation(id, {
      status: 'archived',
      archivedAt: now,
    })

    const detail = await findConversationWithAgents(id)
    if (!detail) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')
    return this.toDetail(detail)
  }

  async unarchiveConversation(
    id: string,
  ): Promise<ConversationDetail> {
    const existing = await findConversationById(id)
    if (!existing) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')

    await updateConversation(id, {
      status: 'active',
      archivedAt: null,
    })

    const detail = await findConversationWithAgents(id)
    if (!detail) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')
    return this.toDetail(detail)
  }

  async renameConversation(
    id: string,
    title: string,
  ): Promise<ConversationDetail> {
    const existing = await findConversationById(id)
    if (!existing) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')

    await updateConversation(id, { title })

    const detail = await findConversationWithAgents(id)
    if (!detail) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')
    return this.toDetail(detail)
  }

  async updateConversationFields(
    id: string,
    input: UpdateConversationBody,
  ): Promise<ConversationDetail> {
    const existing = await findConversationById(id)
    if (!existing) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')

    const repoInput: Parameters<typeof updateConversation>[1] = {}

    if (input.title !== undefined) repoInput.title = input.title
    if (input.status !== undefined) repoInput.status = input.status
    if (input.orchestratorAgentId !== undefined) repoInput.orchestratorAgentId = input.orchestratorAgentId
    if (input.metadata !== undefined) repoInput.metadataJson = input.metadata as MetadataJson

    if (input.status === 'archived') {
      repoInput.archivedAt = new Date().toISOString()
    } else if (input.status === 'active') {
      repoInput.archivedAt = null
    }

    await updateConversation(id, repoInput)

    const detail = await findConversationWithAgents(id)
    if (!detail) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')
    return this.toDetail(detail)
  }

  async pinConversation(
    id: string,
  ): Promise<ConversationListItem> {
    const existing = await findConversationById(id)
    if (!existing) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')

    if (existing.pinnedAt) return this.toListItem({ ...existing, agents: [] })

    await updateConversation(id, {
      pinnedAt: new Date().toISOString(),
    })

    const updated = await findConversationById(id)
    if (!updated) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')
    return this.toListItem({ ...updated, agents: [] })
  }

  async unpinConversation(
    id: string,
  ): Promise<ConversationListItem> {
    const existing = await findConversationById(id)
    if (!existing) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')

    await updateConversation(id, { pinnedAt: null })

    const updated = await findConversationById(id)
    if (!updated) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')
    return this.toListItem({ ...updated, agents: [] })
  }

  async deleteConversation(id: string): Promise<void> {
    const existing = await findConversationById(id)
    if (!existing) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')

    await deleteConversationById(id)
  }
}