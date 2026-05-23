import {
  createConversation,
  findConversationById,
  findConversationWithAgents,
  updateConversation,
  deleteConversationById,
  listConversations,
  countConversations,
  type ConversationOutput,
  type ConversationDetailOutput,
} from '../repositories/conversation.repo'
import { createConversationAgent } from '../repositories/conversation-agent.repo'
import { badRequest, notFound } from '../lib/errors'
import type {
  ConversationDetail,
  ConversationListItem,
  ConversationAgentItem,
  CreateConversationBody,
  ListConversationsQuery,
  UpdateConversationBody,
} from '../domains/conversation/types'
import type { ConversationMode, ConversationStatus, MetadataJson } from '../lib/types'

export class ConversationService {
  private toListItem(o: ConversationOutput): ConversationListItem {
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
      for (let i = 0; i < input.agents.length; i++) {
        const agent = input.agents[i]
        await createConversationAgent({
          conversationId: conv.id,
          agentId: agent.agentId,
          role: agent.role,
          sortOrder: i,
        })
      }

      if (input.mode === 'group' && !input.orchestratorAgentId) {
        const orchestrator = input.agents.find((a) => a.role === 'orchestrator')
        if (orchestrator) {
          await updateConversation(conv.id, {
            orchestratorAgentId: orchestrator.agentId,
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

  async listConversationsPaginated(
    query: ListConversationsQuery,
  ): Promise<{ items: ConversationListItem[]; total: number }> {
    const { status, limit, offset } = query

    const [items, total] = await Promise.all([
      listConversations({ status, limit, offset }),
      countConversations({ status }),
    ])

    return {
      items: items.map((o) => this.toListItem(o)),
      total,
    }
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

    if (existing.pinnedAt) return this.toListItem(existing)

    await updateConversation(id, {
      pinnedAt: new Date().toISOString(),
    })

    const updated = await findConversationById(id)
    if (!updated) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')
    return this.toListItem(updated)
  }

  async unpinConversation(
    id: string,
  ): Promise<ConversationListItem> {
    const existing = await findConversationById(id)
    if (!existing) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')

    await updateConversation(id, { pinnedAt: null })

    const updated = await findConversationById(id)
    if (!updated) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')
    return this.toListItem(updated)
  }

  async deleteConversation(id: string): Promise<void> {
    const existing = await findConversationById(id)
    if (!existing) throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')

    await deleteConversationById(id)
  }
}