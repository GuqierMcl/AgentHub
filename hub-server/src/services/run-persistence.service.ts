import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { AppError, notFound } from '../lib/errors'
import type { RuntimeClient } from '../lib/runtime'
import { logger } from '../lib/logger'
import type { RunStatus, MessageSurface } from '../lib/types'
import {
  findConversationWithAgents,
  updateConversation,
  type ConversationDetailOutput,
} from '../repositories/conversation.repo'
import {
  createMessage,
  findMessageWithParts,
  findMessageByRunAndRuntimeMessageId,
  listMessagesByRun,
  listMessagesWithParts,
  updateMessage,
  type MessageOutput,
} from '../repositories/message.repo'
import {
  createMessagePart,
  findMessagePartByMessageAndKey,
  listMessagePartsByMessage,
  updateMessagePart,
} from '../repositories/message-part.repo'
import {
  createRun,
  findRunById,
  listRuns,
  updateRun,
  type RunOutput,
} from '../repositories/run.repo'
import {
  createRunEvent,
  findRunEventById,
  listRunEventsByRun,
  listRunEventsByRunAfterSequence,
  type RunEventOutput,
} from '../repositories/run-event.repo'
import {
  createRunToolCall,
  findRunToolCallByRunAndToolCall,
  listRunToolCallsByConversation,
  listRunToolCallsByRun,
  updateRunToolCall,
  type RunToolCallOutput,
} from '../repositories/run-tool-call.repo'
import {
  createRunReasoningBlock,
  findRunReasoningBlockByRunAndReasoning,
  listRunReasoningBlocksByConversation,
  listRunReasoningBlocksByRun,
  updateRunReasoningBlock,
  type RunReasoningBlockOutput,
} from '../repositories/run-reasoning-block.repo'
import {
  createRunTaskGroup,
  findRunTaskGroupByRunAndGroupId,
  listRunTaskGroupsByConversation,
  listRunTaskGroupsByRun,
  updateRunTaskGroup,
  type RunTaskGroupOutput,
} from '../repositories/run-task-group.repo'
import {
  createRunTask,
  findRunTaskByRunAndTaskId,
  listRunTasksByConversation,
  listRunTasksByRun,
  updateRunTask,
  type RunTaskOutput,
} from '../repositories/run-task.repo'
import {
  createRunPlan,
  findLatestRunPlanByRun,
  findLatestRunPlanByConversation,
  findRunPlanByRunAndSourceEvent,
  listRunPlansByConversation,
  updateRunPlan,
  type RunPlanOutput,
} from '../repositories/run-plan.repo'
import {
  createRunPlanTask,
  findRunPlanTaskByPlanAndTaskId,
  listRunPlanTasksByConversation,
  updateRunPlanTask,
  type RunPlanTaskOutput,
} from '../repositories/run-plan-task.repo'
import {
  createPermissionRequest,
  findPermissionRequestByRunAndRuntimeRequestId,
  listPermissionRequests,
  listPermissionRequestsByConversation,
  updatePermissionRequest,
  type PermissionRequestOutput,
} from '../repositories/permission-request.repo'

export type RuntimeRunEvent = {
  id: string
  runId: string
  type: string
  timestamp: string
  agentId?: string
  parentAgentId?: string
  parentTaskId?: string
  taskId?: string
  groupId?: string
  toolCallId?: string
  toolName?: string
  messageId?: string
  messageIndex?: number
  data?: unknown
}

type RuntimeMessage = {
  id?: string
  role: 'user' | 'assistant' | 'system'
  agentId?: string
  content: string
}

type RuntimeRunInput = {
  conversationId: string
  mode: 'single' | 'group'
  participantAgentIds: string[]
  addressedAgentIds: string[]
  userMessage: RuntimeMessage & { role: 'user' }
  history: RuntimeMessage[]
  conversationState: {
    messageCountBeforeRun: number
    titleSource: 'default' | 'auto' | 'manual'
  }
  workspace?: {
    workspaceId: string
    backendType: 'local'
    rootPath: string
  }
  diagnostics: {
    includeModelStream: boolean
    includeReasoning: boolean
    includeRawModelChunks: boolean
  }
}

type RuntimeRunCreateResponse = {
  runId: string
  status: RunStatus
  entryAgentIds: string[]
  entryReason: string
  eventsUrl: string
}

export type PersistedMessagePart = {
  id: string
  messageId: string
  conversationId: string
  runId: string | null
  runtimeEventId: string | null
  partKey: string
  partIndex: number
  entityType: string | null
  entityId: string | null
  type: string
  state: string
  text: string | null
  payloadJson: Record<string, unknown>
  firstEventSequence: number | null
  lastEventSequence: number | null
  createdAt: string
  updatedAt: string
}

export type PersistedMessage = MessageOutput & {
  parts: PersistedMessagePart[]
}

export type ActiveRunSnapshot = {
  id: string
  runtimeId: string | null
  status: RunStatus
  lastEventSequence: number
  plan: Record<string, unknown> | null
}

export type RunPlanSnapshot = {
  runId: string
  status: RunStatus
  plan: Record<string, unknown>
  updatedAt: string
  completedAt: string | null
}

export type ConversationRunItemsSnapshot = {
  toolCalls: RunToolCallOutput[]
  reasoningBlocks: RunReasoningBlockOutput[]
  taskGroups: RunTaskGroupOutput[]
  tasks: RunTaskOutput[]
  plans: RunPlanOutput[]
  planTasks: RunPlanTaskOutput[]
  permissionRequests: PermissionRequestOutput[]
}

export type ConversationTimelineRunSnapshot = {
  run: {
    id: string
    runtimeId: string | null
    status: RunStatus
    triggerMessageId: string
    createdAt: string
    lastEventSequence: number
  }
  triggerMessage: PersistedMessage | null
  events: HubRunEventEnvelope[]
}

export type ConversationMessagesResponse = {
  messages: PersistedMessage[]
  activeRun: ActiveRunSnapshot | null
  latestPlan: RunPlanSnapshot | null
  runItems: ConversationRunItemsSnapshot
  timelineRuns: ConversationTimelineRunSnapshot[]
}

export type HubRunEventEnvelope = {
  sequence: number
  event: RuntimeRunEvent
}

type RunListener = (envelope: HubRunEventEnvelope) => void

export class RunPersistenceService {
  private consumers = new Map<string, AbortController>()
  private listeners = new Map<string, Set<RunListener>>()

  constructor(private runtimeClient: RuntimeClient) {}

  async sendMessage(
    conversationId: string,
    content: string,
  ): Promise<ConversationMessagesResponse> {
    const trimmed = content.trim()
    if (!trimmed) {
      throw new AppError(400 as ContentfulStatusCode, 'MESSAGE_EMPTY', 'Message content is empty')
    }

    const conversation = await findConversationWithAgents(conversationId)
    if (!conversation) {
      throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')
    }

    const existingActiveRun = await this.findActiveRun(conversationId)
    if (existingActiveRun) {
      throw new AppError(409 as ContentfulStatusCode, 'RUN_ALREADY_ACTIVE', '当前会话已有正在运行的回复')
    }

    const historyMessages = (
      await listMessagesWithParts(conversationId, { limit: 100, order: 'desc' })
    ).reverse()
    const history = projectMessagesToRuntimeHistory(historyMessages)

    const userMessage = await createMessage({
      conversationId,
      surface: 'chat',
      role: 'user',
      senderType: 'user',
      senderId: 'user',
      status: 'completed',
      firstEventSequence: 0,
      lastEventSequence: 0,
      completedAt: new Date().toISOString(),
    })
    const userMessagePart = await createMessagePart({
      messageId: userMessage.id,
      conversationId,
      partKey: 'text',
      partIndex: 0,
      type: 'text',
      state: 'done',
      text: trimmed,
      firstEventSequence: 0,
      lastEventSequence: 0,
    })
    await updateConversation(conversationId, {
      lastMessageId: userMessage.id,
      lastMessageAt: userMessage.createdAt,
    })

    const run = await createRun({
      conversationId,
      triggerMessageId: userMessage.id,
      mode: conversation.mode as 'single' | 'group',
      status: 'queued',
      orchestratorAgentId: conversation.orchestratorAgentId ?? undefined,
    })
    await updateMessage(userMessage.id, { runId: run.id })
    await updateMessagePart(userMessagePart.id, { runId: run.id })

    const input = buildRuntimeRunInput(conversation, trimmed, history)
    await updateRun(run.id, { inputJson: input })

    const response = await this.runtimeClient.forward('POST', '/runtime/runs', input, { raw: true })
    if (response.status < 200 || response.status >= 300) {
      await updateRun(run.id, {
        status: 'failed',
        errorJson: normalizeRuntimeError(response.data),
        completedAt: new Date().toISOString(),
      })
      throw new AppError(response.status as ContentfulStatusCode, 'RUNTIME_RUN_CREATE_FAILED', getRuntimeErrorMessage(response.data))
    }

    const runtimeRun = response.data as RuntimeRunCreateResponse
    await updateRun(run.id, {
      runtimeId: runtimeRun.runId,
      status: runtimeRun.status,
    })
    this.startRuntimeConsumer(run.id, runtimeRun.runId)

    return this.listConversationMessages(conversationId)
  }

  async listConversationMessages(
    conversationId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<ConversationMessagesResponse> {
    const conversation = await findConversationWithAgents(conversationId)
    if (!conversation) {
      throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')
    }

    const messages = await listMessagesWithParts(conversationId, opts)
    const activeRun = await this.findActiveRun(conversationId)
    const activeRunSnapshot = activeRun
      ? await this.toActiveRunSnapshot(activeRun)
      : null
    const latestPlanRun = await findLatestRunPlanByConversation(conversationId)
    const latestPlanRunRecord = latestPlanRun ? await findRunById(latestPlanRun.runId) : null
    const runItems = await this.listConversationRunItems(conversationId)
    const timelineRuns = await this.listConversationTimelineRuns(conversationId, opts)

    return {
      messages: messages.map(toPersistedMessage).sort(comparePersistedMessages),
      activeRun: activeRunSnapshot,
      latestPlan: latestPlanRun
        ? {
            runId: latestPlanRun.runId,
            status: latestPlanRunRecord?.status ?? 'completed',
            plan: planToRecord(latestPlanRun),
            updatedAt: latestPlanRun.updatedAt,
            completedAt: latestPlanRunRecord?.completedAt ?? latestPlanRun.completedAt,
          }
        : null,
      runItems,
      timelineRuns,
    }
  }

  async cancelRun(runId: string): Promise<ActiveRunSnapshot> {
    const run = await findRunById(runId)
    if (!run) {
      throw notFound('RUN_NOT_FOUND', 'Run 不存在')
    }
    const runtimeId = run.runtimeId
    if (!runtimeId) {
      await updateRun(runId, { status: 'cancelled', completedAt: new Date().toISOString() })
      const latest = await findRunById(runId)
      return this.toActiveRunSnapshot(latest)
    }

    await this.runtimeClient.forward('POST', `/runtime/runs/${encodeURIComponent(runtimeId)}/cancel`, undefined, { raw: true })
    const latest = await findRunById(runId)
    return this.toActiveRunSnapshot(latest)
  }

  async listRunEventsAfter(
    runId: string,
    afterSequence: number,
  ): Promise<HubRunEventEnvelope[]> {
    const run = await findRunById(runId)
    if (!run) {
      throw notFound('RUN_NOT_FOUND', 'Run 不存在')
    }
    const events = await listRunEventsByRunAfterSequence(runId, afterSequence)
    return events.flatMap(toHubEnvelope)
  }

  async getRunStatus(runId: string): Promise<RunStatus> {
    const run = await findRunById(runId)
    if (!run) {
      throw notFound('RUN_NOT_FOUND', 'Run 不存在')
    }
    return run.status
  }

  subscribe(runId: string, listener: RunListener): () => void {
    const listeners = this.listeners.get(runId) ?? new Set<RunListener>()
    listeners.add(listener)
    this.listeners.set(runId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.listeners.delete(runId)
      }
    }
  }

  isTerminalRunStatus(status?: string | null): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled'
  }

  private async findActiveRun(conversationId: string): Promise<RunOutput | null> {
    const runs = await listRuns({ conversationId, limit: 10, order: 'desc' })
    return runs.find((run) => !this.isTerminalRunStatus(run.status)) ?? null
  }

  private async toActiveRunSnapshot(run: RunOutput | null): Promise<ActiveRunSnapshot> {
    if (!run) {
      throw notFound('RUN_NOT_FOUND', 'Run 不存在')
    }
    return {
      id: run.id,
      runtimeId: run.runtimeId,
      status: run.status,
      lastEventSequence: run.lastEventSequence ?? 0,
      plan: run.planJson,
    }
  }

  private async listConversationRunItems(
    conversationId: string,
  ): Promise<ConversationRunItemsSnapshot> {
    const [
      toolCalls,
      reasoningBlocks,
      taskGroups,
      tasks,
      plans,
      planTasks,
      permissionRequests,
    ] = await Promise.all([
      listRunToolCallsByConversation(conversationId),
      listRunReasoningBlocksByConversation(conversationId),
      listRunTaskGroupsByConversation(conversationId),
      listRunTasksByConversation(conversationId),
      listRunPlansByConversation(conversationId),
      listRunPlanTasksByConversation(conversationId),
      listPermissionRequestsByConversation(conversationId),
    ])

    return {
      toolCalls,
      reasoningBlocks,
      taskGroups,
      tasks,
      plans,
      planTasks,
      permissionRequests,
    }
  }

  private async listConversationTimelineRuns(
    conversationId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<ConversationTimelineRunSnapshot[]> {
    const runs = await listRuns({
      conversationId,
      limit: opts?.limit ?? 50,
      offset: opts?.offset ?? 0,
      order: 'asc',
    })

    const snapshots = await Promise.all(
      runs.map(async (run): Promise<ConversationTimelineRunSnapshot> => {
        const [triggerMessageRecord, events] = await Promise.all([
          findMessageWithParts(run.triggerMessageId),
          listRunEventsByRun(run.id),
        ])

        return {
          run: {
            id: run.id,
            runtimeId: run.runtimeId,
            status: run.status,
            triggerMessageId: run.triggerMessageId,
            createdAt: run.createdAt,
            lastEventSequence: run.lastEventSequence ?? 0,
          },
          triggerMessage: triggerMessageRecord
            ? toPersistedMessage(triggerMessageRecord as Record<string, unknown>)
            : null,
          events: events.flatMap(toHubEnvelope),
        }
      }),
    )

    return snapshots.sort(compareTimelineRuns)
  }

  private startRuntimeConsumer(runId: string, runtimeRunId: string): void {
    if (this.consumers.has(runId)) return

    const abortController = new AbortController()
    this.consumers.set(runId, abortController)
    void this.consumeRuntimeEvents(runId, runtimeRunId, abortController)
  }

  private async consumeRuntimeEvents(
    runId: string,
    runtimeRunId: string,
    abortController: AbortController,
  ): Promise<void> {
    try {
      const response = await this.runtimeClient.stream(
        `/runtime/runs/${encodeURIComponent(runtimeRunId)}/events`,
        { signal: abortController.signal },
      )
      if (!response.ok || !response.body) {
        await updateRun(runId, {
          status: 'failed',
          errorJson: { message: `Runtime event stream failed (${response.status})` },
          completedAt: new Date().toISOString(),
        })
        return
      }

      for await (const event of readSseRuntimeEvents(response.body)) {
        const envelope = await this.persistAndProjectRuntimeEvent(runId, event)
        if (!envelope) continue
        this.publish(runId, envelope)
        if (this.isTerminalRunEvent(event)) {
          break
        }
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        logger.error({ err: error, runId, runtimeRunId }, 'Runtime event consumer failed')
        await updateRun(runId, {
          status: 'failed',
          errorJson: { message: error instanceof Error ? error.message : 'Runtime event consumer failed' },
          completedAt: new Date().toISOString(),
        })
      }
    } finally {
      this.consumers.delete(runId)
    }
  }

  private async persistAndProjectRuntimeEvent(
    runId: string,
    event: RuntimeRunEvent,
  ): Promise<HubRunEventEnvelope | null> {
    const existing = await findRunEventById(event.id)
    if (existing) return null

    const run = await findRunById(runId)
    if (!run) return null
    const sequence = (run.lastEventSequence ?? 0) + 1
    const stored = await createRunEvent({
      id: event.id,
      runId,
      runtimeRunId: event.runId,
      conversationId: run.conversationId,
      agentId: event.agentId,
      parentAgentId: event.parentAgentId,
      parentTaskId: event.parentTaskId,
      taskId: event.taskId,
      groupId: event.groupId,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      messageId: event.messageId,
      messageIndex: event.messageIndex,
      type: event.type,
      sequence,
      occurredAt: event.timestamp,
      payloadJson: { event },
    })

    await updateRun(runId, { lastEventSequence: sequence })
    await this.projectRuntimeEvent(run, event, sequence)
    return toHubEnvelope(stored)[0] ?? null
  }

  private async projectRuntimeEvent(
    run: RunOutput,
    event: RuntimeRunEvent,
    sequence: number,
  ): Promise<void> {
    const runId = run.id
    const timestamp = event.timestamp ?? new Date().toISOString()

    if (event.type === 'run.started') {
      await updateRun(runId, { status: 'running', startedAt: timestamp })
      return
    }
    if (event.type === 'run.completed') {
      await updateRun(runId, { status: 'completed', completedAt: timestamp })
      await finalizeRunProjection(runId, 'completed', timestamp)
      return
    }
    if (event.type === 'run.failed') {
      await updateRun(runId, {
        status: 'failed',
        errorJson: getEventDataRecord(event),
        completedAt: timestamp,
      })
      await finalizeRunProjection(runId, 'failed', timestamp)
      return
    }
    if (event.type === 'run.cancelled') {
      await updateRun(runId, { status: 'cancelled', completedAt: timestamp })
      await finalizeRunProjection(runId, 'cancelled', timestamp)
      return
    }
    if (event.type === 'permission.requested') {
      await updateRun(runId, { status: 'waiting_approval' })
      await projectPermissionEvent(run, event, sequence)
      return
    }
    if (
      event.type === 'permission.approved' ||
      event.type === 'permission.denied' ||
      event.type === 'permission.cancelled'
    ) {
      await updateRun(runId, { status: 'running' })
      await projectPermissionEvent(run, event, sequence)
      return
    }
    if (event.type === 'task.group.started' || event.type === 'task.group.completed') {
      await projectTaskGroupEvent(run, event, sequence)
      return
    }
    if (event.type === 'task.started' || event.type === 'task.completed' || event.type === 'task.failed') {
      await projectTaskEvent(run, event, sequence)
      return
    }
    if (event.type === 'tool.started' || event.type === 'tool.completed' || event.type === 'tool.failed') {
      await projectToolEvent(run, event, sequence)
      if (event.type === 'tool.completed' && event.toolName === 'write_plan') {
        await projectPlanEvent(run, event, sequence)
      }
      return
    }
    if (event.type === 'orchestrator.plan.created') {
      await projectPlanEvent(run, event, sequence)
      return
    }
    if (event.type === 'reasoning.started' || event.type === 'reasoning.delta' || event.type === 'reasoning.completed') {
      await projectReasoningEvent(run, event, sequence)
      return
    }
    if (event.type === 'message.delta' || event.type === 'message.completed') {
      await projectRuntimeMessageEvent(run, event, sequence)
      return
    }
  }

  private isTerminalRunEvent(event: RuntimeRunEvent): boolean {
    return event.type === 'run.completed' ||
      event.type === 'run.failed' ||
      event.type === 'run.cancelled'
  }

  private publish(runId: string, envelope: HubRunEventEnvelope): void {
    const listeners = this.listeners.get(runId)
    if (!listeners) return
    for (const listener of listeners) {
      listener(envelope)
    }
  }
}

async function projectRuntimeMessageEvent(
  run: RunOutput,
  event: RuntimeRunEvent,
  sequence: number,
): Promise<void> {
  const runtimeMessageId = resolveRuntimeMessageId(event)
  const messageId = resolveLocalMessageId(run.id, runtimeMessageId)
  const surface = resolveMessageSurface(run, event)
  const data = getEventDataRecord(event)
  const text = event.type === 'message.delta'
    ? getString(data.delta)
    : getString(data.content)

  if (event.type === 'message.delta' && !text) {
    return
  }
  if (event.type === 'message.completed' && text === undefined && !event.messageId) {
    return
  }

  let message = await findMessageByRunAndRuntimeMessageId(run.id, runtimeMessageId)
  if (!message) {
    message = await createMessage({
      id: messageId,
      conversationId: run.conversationId,
      runId: run.id,
      runtimeMessageId,
      runtimeRunId: event.runId,
      messageIndex: event.messageIndex ?? null,
      surface,
      role: 'assistant',
      senderType: surface === 'chat'
        ? event.agentId === run.orchestratorAgentId
          ? 'orchestrator'
          : 'agent'
        : 'agent',
      senderId: event.agentId,
      agentId: event.agentId,
      taskId: event.taskId ?? event.parentTaskId ?? null,
      groupId: event.groupId ?? null,
      status: 'streaming',
      firstEventSequence: sequence,
      lastEventSequence: sequence,
      metadataJson: {
        runtime: {
          messageId: runtimeMessageId,
          runtimeRunId: event.runId,
          messageIndex: event.messageIndex ?? null,
          surface,
          firstEventSequence: sequence,
        },
      },
    })
  }

  const currentParts = await listMessagePartsByMessage(message.id)
  let textPart = await findMessagePartByMessageAndKey(message.id, 'text')
  if (!textPart) {
    textPart = await createMessagePart({
      messageId: message.id,
      conversationId: run.conversationId,
      runId: run.id,
      runtimeEventId: event.id,
      partKey: 'text',
      partIndex: currentParts.length,
      entityType: 'runtime_message',
      entityId: message.id,
      type: 'text',
      state: event.type === 'message.completed' ? 'done' : 'streaming',
      text: text ?? '',
      payloadJson: data,
      firstEventSequence: sequence,
      lastEventSequence: sequence,
    })
  } else {
    const nextText = event.type === 'message.completed'
      ? text ?? textPart.text ?? ''
      : `${textPart.text ?? ''}${text ?? ''}`
    await updateMessagePart(textPart.id, {
      state: event.type === 'message.completed' ? 'done' : 'streaming',
      text: nextText,
      payloadJson: data,
      entityType: 'runtime_message',
      entityId: message.id,
      firstEventSequence: textPart.firstEventSequence ?? sequence,
      lastEventSequence: sequence,
    })
  }

  await updateMessage(message.id, {
    runtimeMessageId,
    runtimeRunId: event.runId,
    messageIndex: message.messageIndex ?? event.messageIndex ?? null,
    surface,
    taskId: event.taskId ?? event.parentTaskId ?? null,
    groupId: event.groupId ?? null,
    firstEventSequence: message.firstEventSequence ?? sequence,
    lastEventSequence: sequence,
    status: event.type === 'message.completed' ? 'completed' : 'streaming',
    finishReason: event.type === 'message.completed' ? 'stop' : undefined,
    completedAt: event.type === 'message.completed' ? event.timestamp : undefined,
    metadataJson: mergeRuntimeMetadata(message.metadataJson, {
      messageId: runtimeMessageId,
      runtimeRunId: event.runId,
      messageIndex: event.messageIndex ?? null,
      surface,
      firstEventSequence: message.firstEventSequence ?? sequence,
      lastEventSequence: sequence,
    }),
  })

  if (surface === 'chat') {
    await updateConversation(run.conversationId, {
      lastMessageId: message.id,
      lastMessageAt: event.timestamp,
    })
  }
}

async function projectToolEvent(
  run: RunOutput,
  event: RuntimeRunEvent,
  sequence: number,
): Promise<void> {
  if (!event.toolCallId || !event.toolName) return
  const data = getEventDataRecord(event)
  const state = event.type === 'tool.started'
    ? 'input-available'
    : event.type === 'tool.completed'
      ? 'output-available'
      : 'output-error'
  const displayPolicy = event.toolName === 'run_task' ? 'event_log_only' : 'timeline'

  let toolCall = await findRunToolCallByRunAndToolCall(run.id, event.toolCallId)
  if (!toolCall) {
    toolCall = await createRunToolCall({
      runId: run.id,
      conversationId: run.conversationId,
      toolCallId: event.toolCallId,
      agentId: event.agentId ?? null,
      parentAgentId: event.parentAgentId ?? null,
      parentTaskId: event.parentTaskId ?? null,
      taskId: event.taskId ?? null,
      groupId: event.groupId ?? null,
      messageId: event.messageId ?? null,
      messageIndex: event.messageIndex ?? null,
      toolName: event.toolName,
      displayPolicy,
      state,
      riskLevel: getString(data.riskLevel) ?? null,
      summary: getString(data.summary) ?? null,
      inputJson: getRecord(data.input) ?? getRecord(data.parameters) ?? null,
      outputJson: getRecord(data.data) ?? getRecord(data.result) ?? null,
      errorJson: getRecord(data.error) ?? null,
      payloadJson: data,
      firstEventSequence: sequence,
      lastEventSequence: sequence,
      startedAt: event.type === 'tool.started' ? event.timestamp : null,
      completedAt: event.type === 'tool.started' ? null : event.timestamp,
    })
  } else {
    await updateRunToolCall(toolCall.id, {
      agentId: event.agentId ?? toolCall.agentId,
      parentAgentId: event.parentAgentId ?? toolCall.parentAgentId,
      parentTaskId: event.parentTaskId ?? toolCall.parentTaskId,
      taskId: event.taskId ?? toolCall.taskId,
      groupId: event.groupId ?? toolCall.groupId,
      messageId: event.messageId ?? toolCall.messageId,
      messageIndex: event.messageIndex ?? toolCall.messageIndex,
      toolName: event.toolName,
      displayPolicy,
      state,
      riskLevel: getString(data.riskLevel) ?? toolCall.riskLevel,
      summary: getString(data.summary) ?? toolCall.summary,
      inputJson: getRecord(data.input) ?? getRecord(data.parameters) ?? toolCall.inputJson,
      outputJson: getRecord(data.data) ?? getRecord(data.result) ?? toolCall.outputJson,
      errorJson: getRecord(data.error) ?? toolCall.errorJson,
      payloadJson: data,
      firstEventSequence: toolCall.firstEventSequence ?? sequence,
      lastEventSequence: sequence,
      startedAt: event.type === 'tool.started' ? event.timestamp : toolCall.startedAt,
      completedAt: event.type === 'tool.started' ? toolCall.completedAt : event.timestamp,
    })
  }

  if (displayPolicy === 'event_log_only' || !event.messageId) {
    return
  }

  let message = await findMessageByRunAndRuntimeMessageId(run.id, resolveRuntimeMessageId(event))
  if (!message) {
    return
  }
  await upsertMessagePartForRuntimeEvent(
    run,
    message,
    event,
    sequence,
    'tool',
    `tool:${event.toolCallId}`,
    'tool_call',
    event.toolCallId,
    state,
    getString(data.summary) ?? getString(data.message) ?? getString(getRecord(data.data)?.summary) ?? getString(getRecord(data.result)?.summary) ?? undefined,
    true,
  )
}

async function projectReasoningEvent(
  run: RunOutput,
  event: RuntimeRunEvent,
  sequence: number,
): Promise<void> {
  const data = getEventDataRecord(event)
  const reasoningId = getString(data.reasoningId) ?? 'default'
  const state = event.type === 'reasoning.completed' ? 'completed' : 'streaming'
  const delta = getString(data.delta)
  const content = getString(data.content)

  let block = await findRunReasoningBlockByRunAndReasoning(run.id, reasoningId)
  if (!block) {
    block = await createRunReasoningBlock({
      runId: run.id,
      conversationId: run.conversationId,
      reasoningId,
      agentId: event.agentId ?? null,
      parentAgentId: event.parentAgentId ?? null,
      parentTaskId: event.parentTaskId ?? null,
      taskId: event.taskId ?? null,
      groupId: event.groupId ?? null,
      messageId: event.messageId ?? null,
      messageIndex: event.messageIndex ?? null,
      content: content ?? delta ?? '',
      state,
      payloadJson: data,
      firstEventSequence: sequence,
      lastEventSequence: sequence,
      startedAt: event.type === 'reasoning.started' ? event.timestamp : null,
      completedAt: event.type === 'reasoning.completed' ? event.timestamp : null,
    })
  } else {
    const nextContent = event.type === 'reasoning.delta'
      ? `${block.content ?? ''}${delta ?? ''}`
      : content ?? block.content
    await updateRunReasoningBlock(block.id, {
      agentId: event.agentId ?? block.agentId,
      parentAgentId: event.parentAgentId ?? block.parentAgentId,
      parentTaskId: event.parentTaskId ?? block.parentTaskId,
      taskId: event.taskId ?? block.taskId,
      groupId: event.groupId ?? block.groupId,
      messageId: event.messageId ?? block.messageId,
      messageIndex: event.messageIndex ?? block.messageIndex,
      content: nextContent,
      state,
      payloadJson: data,
      firstEventSequence: block.firstEventSequence ?? sequence,
      lastEventSequence: sequence,
      startedAt: event.type === 'reasoning.started' ? event.timestamp : block.startedAt,
      completedAt: event.type === 'reasoning.completed' ? event.timestamp : block.completedAt,
    })
  }

  if (!event.messageId) {
    return
  }

  const message = await findMessageByRunAndRuntimeMessageId(run.id, resolveRuntimeMessageId(event))
  if (!message) return
  await upsertMessagePartForRuntimeEvent(
    run,
    message,
    event,
    sequence,
    'reasoning',
    `reasoning:${reasoningId}`,
    'reasoning_block',
    reasoningId,
    state === 'completed' ? 'done' : 'streaming',
    state === 'completed' ? (content ?? delta ?? '') : delta ?? content ?? '',
    state === 'completed',
  )
}

async function projectPermissionEvent(
  run: RunOutput,
  event: RuntimeRunEvent,
  sequence: number,
): Promise<void> {
  const data = getEventDataRecord(event)
  const requestId = getString(data.requestId) ?? event.toolCallId ?? event.id
  const status = mapPermissionStatus(event.type)
  const reason = getString(data.reason) ?? getString(data.message) ?? getString(data.summary) ?? null

  let request = await findPermissionRequestByRunAndRuntimeRequestId(run.id, requestId)
  if (!request) {
    request = await createPermissionRequest({
      conversationId: run.conversationId,
      runId: run.id,
      agentId: event.agentId ?? 'unknown',
      runtimeRequestId: requestId,
      messageId: event.messageId ?? null,
      messageIndex: event.messageIndex ?? null,
      parentAgentId: event.parentAgentId ?? null,
      taskId: event.taskId ?? null,
      groupId: event.groupId ?? null,
      parentTaskId: event.parentTaskId ?? null,
      toolCallId: event.toolCallId ?? null,
      toolName: event.toolName ?? null,
      riskLevel: getString(data.riskLevel) ?? null,
      permissionType: 'command_execute',
      target: event.toolName ?? 'tool',
      description: reason ?? 'Runtime permission request',
      status,
      reason,
      decisionReason: getString(data.decisionReason) ?? null,
      grantJson: getRecord(data.grant) ?? null,
      dataJson: getRecord(data.data) ?? null,
      payloadJson: data,
      firstEventSequence: sequence,
      lastEventSequence: sequence,
      metadataJson: {
        runtime: {
          requestId,
          eventType: event.type,
        },
      },
      expiresAt: getString(data.expiresAt) ?? null,
    })
  } else {
    await updatePermissionRequest(request.id, {
      status,
      resolvedAt: status === 'pending' ? request.resolvedAt : event.timestamp,
      reason,
      decisionReason: getString(data.decisionReason) ?? request.decisionReason ?? undefined,
      grantJson: getRecord(data.grant) ?? request.grantJson,
      dataJson: getRecord(data.data) ?? request.dataJson,
      payloadJson: data,
      firstEventSequence: request.firstEventSequence ?? sequence,
      lastEventSequence: sequence,
      metadataJson: request.metadataJson,
    })
  }

  if (!event.messageId) {
    return
  }

  const message = await findMessageByRunAndRuntimeMessageId(run.id, resolveRuntimeMessageId(event))
  if (!message) return
  await upsertMessagePartForRuntimeEvent(
    run,
    message,
    event,
    sequence,
    'permission',
    `permission:${requestId}`,
    'permission_request',
    requestId,
    status === 'approved' ? 'done' : status === 'pending' ? 'streaming' : 'error',
    reason ?? getString(data.description) ?? undefined,
    true,
  )
}

async function projectTaskGroupEvent(
  run: RunOutput,
  event: RuntimeRunEvent,
  sequence: number,
): Promise<void> {
  if (!event.groupId) return
  const data = getEventDataRecord(event)
  const state = event.type === 'task.group.completed' ? 'completed' : 'running'
  let group = await findRunTaskGroupByRunAndGroupId(run.id, event.groupId)
  if (!group) {
    group = await createRunTaskGroup({
      runId: run.id,
      conversationId: run.conversationId,
      groupId: event.groupId,
      agentId: event.agentId ?? null,
      parentAgentId: event.parentAgentId ?? null,
      parentTaskId: event.parentTaskId ?? null,
      title: getString(data.title) ?? null,
      state,
      summary: getString(data.summary) ?? null,
      payloadJson: data,
      firstEventSequence: sequence,
      lastEventSequence: sequence,
      startedAt: event.type === 'task.group.started' ? event.timestamp : null,
      completedAt: event.type === 'task.group.completed' ? event.timestamp : null,
    })
  } else {
    await updateRunTaskGroup(group.id, {
      agentId: event.agentId ?? group.agentId,
      parentAgentId: event.parentAgentId ?? group.parentAgentId,
      parentTaskId: event.parentTaskId ?? group.parentTaskId,
      title: getString(data.title) ?? group.title,
      state,
      summary: getString(data.summary) ?? group.summary,
      payloadJson: data,
      firstEventSequence: group.firstEventSequence ?? sequence,
      lastEventSequence: sequence,
      startedAt: event.type === 'task.group.started' ? event.timestamp : group.startedAt,
      completedAt: event.type === 'task.group.completed' ? event.timestamp : group.completedAt,
    })
  }
}

async function projectTaskEvent(
  run: RunOutput,
  event: RuntimeRunEvent,
  sequence: number,
): Promise<void> {
  if (!event.taskId) return
  const data = getEventDataRecord(event)
  const state = event.type === 'task.started'
    ? 'running'
    : event.type === 'task.completed'
      ? 'completed'
      : 'failed'
  const taskSummary = getString(data.summary) ?? getString(data.message) ?? null
  const taskTitle = getString(data.title) ?? getString(getRecord(data.task)?.title) ?? null
  const expectedOutput = getString(data.expectedOutput) ?? getString(getRecord(data.task)?.expectedOutput) ?? null
  const targetAgentId = getString(data.targetAgentId) ?? getString(getRecord(data.task)?.targetAgentId) ?? null
  const dependsOn = Array.isArray(data.dependsOn) ? data.dependsOn.filter((item): item is string => typeof item === 'string') : []

  if (event.groupId) {
    const existingGroup = await findRunTaskGroupByRunAndGroupId(run.id, event.groupId)
    if (!existingGroup) {
      await projectTaskGroupEvent(run, { ...event, type: 'task.group.started' }, sequence)
    }
  }

  let task = await findRunTaskByRunAndTaskId(run.id, event.taskId)
  if (!task) {
    task = await createRunTask({
      runId: run.id,
      conversationId: run.conversationId,
      taskId: event.taskId,
      groupId: event.groupId ?? null,
      agentId: event.agentId ?? null,
      parentAgentId: event.parentAgentId ?? null,
      parentTaskId: event.parentTaskId ?? null,
      targetAgentId,
      title: taskTitle,
      instruction: getString(data.instruction) ?? getString(getRecord(data.task)?.instruction) ?? null,
      expectedOutput,
      summary: taskSummary,
      state,
      dependsOnJson: dependsOn,
      payloadJson: data,
      firstEventSequence: sequence,
      lastEventSequence: sequence,
      startedAt: event.type === 'task.started' ? event.timestamp : null,
      completedAt: event.type === 'task.completed' || event.type === 'task.failed' ? event.timestamp : null,
    })
  } else {
    await updateRunTask(task.id, {
      groupId: event.groupId ?? task.groupId,
      agentId: event.agentId ?? task.agentId,
      parentAgentId: event.parentAgentId ?? task.parentAgentId,
      parentTaskId: event.parentTaskId ?? task.parentTaskId,
      targetAgentId: targetAgentId ?? task.targetAgentId,
      title: taskTitle ?? task.title,
      instruction: getString(data.instruction) ?? task.instruction,
      expectedOutput: expectedOutput ?? task.expectedOutput,
      summary: taskSummary ?? task.summary,
      state,
      dependsOnJson: dependsOn.length ? dependsOn : task.dependsOnJson,
      payloadJson: data,
      firstEventSequence: task.firstEventSequence ?? sequence,
      lastEventSequence: sequence,
      startedAt: event.type === 'task.started' ? event.timestamp : task.startedAt,
      completedAt: event.type === 'task.completed' || event.type === 'task.failed' ? event.timestamp : task.completedAt,
    })
  }

  const latestPlan = await findLatestRunPlanByRun(run.id)
  if (!latestPlan) {
    return
  }

  const planTask = await findRunPlanTaskByPlanAndTaskId(latestPlan.id, event.taskId)
  if (!planTask) {
    return
  }

  await updateRunPlanTask(planTask.id, {
    targetAgentId: targetAgentId ?? planTask.targetAgentId,
    title: taskTitle ?? planTask.title,
    instruction: getString(data.instruction) ?? planTask.instruction,
    expectedOutput: expectedOutput ?? planTask.expectedOutput,
    state,
    riskLevel: getString(data.riskLevel) ?? planTask.riskLevel,
    dependsOnJson: dependsOn.length ? dependsOn : planTask.dependsOnJson,
    payloadJson: { ...task },
    firstEventSequence: planTask.firstEventSequence ?? sequence,
    lastEventSequence: sequence,
    sortOrder: planTask.sortOrder,
  })
}

async function projectPlanEvent(
  run: RunOutput,
  event: RuntimeRunEvent,
  sequence: number,
): Promise<void> {
  const plan = extractPlan(event)
  if (!plan) return

  const plans = await listRunPlansByConversation(run.conversationId)
  const revision = plans.filter((candidate) => candidate.runId === run.id).length + 1
  let existing = await findRunPlanByRunAndSourceEvent(run.id, event.id)
  if (!existing) {
    existing = await createRunPlan({
      runId: run.id,
      conversationId: run.conversationId,
      sourceEventId: event.id,
      revision,
      entryAgentId: getString(plan.entryAgentId) ?? run.orchestratorAgentId ?? null,
      intent: getString(plan.intent) ?? null,
      summaryInstruction: getString(plan.summaryInstruction) ?? null,
      state: 'completed',
      payloadJson: plan,
      firstEventSequence: sequence,
      lastEventSequence: sequence,
      completedAt: event.timestamp,
    })
  } else {
    existing = await updateRunPlan(existing.id, {
      revision,
      entryAgentId: getString(plan.entryAgentId) ?? existing.entryAgentId,
      intent: getString(plan.intent) ?? existing.intent,
      summaryInstruction: getString(plan.summaryInstruction) ?? existing.summaryInstruction,
      state: 'completed',
      payloadJson: plan,
      firstEventSequence: existing.firstEventSequence ?? sequence,
      lastEventSequence: sequence,
      completedAt: event.timestamp,
    })
  }

  const tasks = Array.isArray(plan.tasks) ? plan.tasks : []
  for (let index = 0; index < tasks.length; index += 1) {
    const task = getRecord(tasks[index])
    if (!task) continue
    const taskId = getString(task.taskId) ?? getString(task.id) ?? `plan-task-${index}`
    const existingTask = await findRunPlanTaskByPlanAndTaskId(existing.id, taskId)
    const taskState = getString(task.status) ?? 'pending'
    if (!existingTask) {
      await createRunPlanTask({
        planId: existing.id,
        conversationId: run.conversationId,
        taskId,
        targetAgentId: getString(task.targetAgentId) ?? null,
        title: getString(task.title) ?? getString(task.instruction) ?? null,
        instruction: getString(task.instruction) ?? null,
        expectedOutput: getString(task.expectedOutput) ?? null,
        state: taskState,
        riskLevel: getString(task.riskLevel) ?? null,
        dependsOnJson: Array.isArray(task.dependsOn)
          ? task.dependsOn.filter((item: unknown): item is string => typeof item === 'string')
          : [],
        payloadJson: task,
        firstEventSequence: sequence,
        lastEventSequence: sequence,
        sortOrder: index,
      })
    } else {
      await updateRunPlanTask(existingTask.id, {
        targetAgentId: getString(task.targetAgentId) ?? existingTask.targetAgentId,
        title: getString(task.title) ?? getString(task.instruction) ?? existingTask.title,
        instruction: getString(task.instruction) ?? existingTask.instruction,
        expectedOutput: getString(task.expectedOutput) ?? existingTask.expectedOutput,
        state: taskState,
        riskLevel: getString(task.riskLevel) ?? existingTask.riskLevel,
        dependsOnJson: Array.isArray(task.dependsOn)
          ? task.dependsOn.filter((item: unknown): item is string => typeof item === 'string')
          : existingTask.dependsOnJson,
        payloadJson: task,
        firstEventSequence: existingTask.firstEventSequence ?? sequence,
        lastEventSequence: sequence,
        sortOrder: index,
      })
    }
  }

  await updateRun(run.id, { planJson: plan })
}

async function finalizeRunProjection(
  runId: string,
  status: 'completed' | 'failed' | 'cancelled',
  completedAt: string,
): Promise<void> {
  const messages = await listMessagesByRun(runId, 'streaming')
  for (const message of messages) {
    const parts = await listMessagePartsByMessage(message.id)
    await Promise.all(
      parts
        .filter((part) => part.state === 'streaming')
        .map((part) =>
          updateMessagePart(part.id, {
            state: status === 'completed' ? 'done' : 'error',
          }),
        ),
    )
    await updateMessage(message.id, {
      status,
      finishReason: status === 'completed' ? 'stop' : status === 'cancelled' ? 'cancelled' : 'error',
      completedAt,
    })
  }

  const toolCalls = await listRunToolCallsByRun(runId)
  for (const toolCall of toolCalls.filter((call) => call.state === 'input-available' || call.state === 'output-available')) {
    await updateRunToolCall(toolCall.id, {
      state: status === 'completed' ? 'output-available' : 'output-error',
      completedAt,
      lastEventSequence: toolCall.lastEventSequence,
    })
  }

  const reasoningBlocks = await listRunReasoningBlocksByRun(runId)
  for (const block of reasoningBlocks.filter((candidate) => candidate.state === 'streaming')) {
    await updateRunReasoningBlock(block.id, {
      state: 'completed',
      completedAt,
      lastEventSequence: block.lastEventSequence,
    })
  }

  const tasks = await listRunTasksByRun(runId)
  for (const task of tasks.filter((candidate) => candidate.state === 'running' || candidate.state === 'pending')) {
    await updateRunTask(task.id, {
      state: status,
      completedAt,
      lastEventSequence: task.lastEventSequence,
    })
  }

  const groups = await listRunTaskGroupsByRun(runId)
  for (const group of groups.filter((candidate) => candidate.state === 'running')) {
    await updateRunTaskGroup(group.id, {
      state: status,
      completedAt,
      lastEventSequence: group.lastEventSequence,
    })
  }

  const permissions = await listPermissionRequests({ runId })
  for (const request of permissions.filter((candidate) => candidate.status === 'pending')) {
    await updatePermissionRequest(request.id, {
      status: 'cancelled',
      resolvedAt: completedAt,
      lastEventSequence: request.lastEventSequence,
    })
  }
}

async function upsertMessagePartForRuntimeEvent(
  run: RunOutput,
  message: MessageOutput,
  event: RuntimeRunEvent,
  sequence: number,
  type: string,
  partKey: string,
  entityType: string,
  entityId: string,
  state: string,
  text?: string,
  replace = false,
): Promise<void> {
  const data = getEventDataRecord(event)
  const existing = await findMessagePartByMessageAndKey(message.id, partKey)
  if (!existing) {
    const parts = await listMessagePartsByMessage(message.id)
    await createMessagePart({
      messageId: message.id,
      conversationId: run.conversationId,
      runId: run.id,
      runtimeEventId: event.id,
      partKey,
      partIndex: parts.length,
      entityType,
      entityId,
      type,
      state,
      text: text ?? '',
      payloadJson: data,
      firstEventSequence: sequence,
      lastEventSequence: sequence,
    })
    return
  }

  const nextText = replace
    ? text ?? existing.text ?? ''
    : text !== undefined
      ? `${existing.text ?? ''}${text}`
      : existing.text ?? ''
  await updateMessagePart(existing.id, {
    state,
    text: nextText,
    payloadJson: data,
    entityType,
    entityId,
    firstEventSequence: existing.firstEventSequence ?? sequence,
    lastEventSequence: sequence,
  })
}

function resolveRuntimeMessageId(event: RuntimeRunEvent): string {
  return event.messageId ??
    `msg_${event.runId}_${event.agentId ?? 'assistant'}_${event.taskId ?? 'entry'}`
}

function resolveLocalMessageId(runId: string, runtimeMessageId: string): string {
  return `msg_${runId}_${runtimeMessageId}`
}

function resolveMessageSurface(run: RunOutput, event: RuntimeRunEvent): MessageSurface {
  if (event.agentId === 'system:title') {
    return 'system'
  }

  const participantAgentIds = getParticipantAgentIds(run)
  if (
    event.agentId &&
    (participantAgentIds.has(event.agentId) || event.agentId === run.orchestratorAgentId)
  ) {
    return 'chat'
  }

  if (event.taskId || event.parentTaskId || event.groupId || event.parentAgentId) {
    return 'task'
  }

  return 'hidden'
}

function getParticipantAgentIds(run: RunOutput): Set<string> {
  const input = run.inputJson as Record<string, unknown>
  const participantAgentIds = Array.isArray(input.participantAgentIds)
    ? input.participantAgentIds
    : []
  return new Set(participantAgentIds.filter((candidate): candidate is string => typeof candidate === 'string'))
}

function mergeRuntimeMetadata(
  metadata: Record<string, unknown>,
  runtime: Record<string, unknown>,
): Record<string, unknown> {
  const currentRuntime = getRecord(metadata.runtime) ?? {}
  return {
    ...metadata,
    runtime: {
      ...currentRuntime,
      ...runtime,
    },
  }
}

function mapPermissionStatus(eventType: RuntimeRunEvent['type']) {
  switch (eventType) {
    case 'permission.requested':
      return 'pending'
    case 'permission.approved':
      return 'approved'
    case 'permission.denied':
      return 'denied'
    case 'permission.cancelled':
      return 'cancelled'
    default:
      return 'pending'
  }
}

function planToRecord(plan: RunPlanOutput): Record<string, unknown> {
  const payload = getRecord(plan.payloadJson) ?? {}
  return {
    ...payload,
    intent: plan.intent ?? (typeof payload.intent === 'string' ? payload.intent : undefined),
    entryAgentId: plan.entryAgentId ?? (typeof payload.entryAgentId === 'string' ? payload.entryAgentId : undefined),
    summaryInstruction: plan.summaryInstruction ?? (typeof payload.summaryInstruction === 'string' ? payload.summaryInstruction : undefined),
    tasks: (plan.tasks ?? []).map((task) => ({
      taskId: task.taskId,
      targetAgentId: task.targetAgentId,
      title: task.title,
      instruction: task.instruction,
      expectedOutput: task.expectedOutput,
      riskLevel: task.riskLevel,
      dependsOn: task.dependsOnJson,
      status: task.state,
    })),
    revision: plan.revision,
  }
}

function comparePersistedMessages(left: PersistedMessage, right: PersistedMessage): number {
  if (left.runId && right.runId && left.runId === right.runId) {
    const leftSeq = getPersistedMessageOrderSequence(left)
    const rightSeq = getPersistedMessageOrderSequence(right)
    if (leftSeq !== rightSeq) {
      return leftSeq - rightSeq
    }
  }

  const leftTime = Date.parse(left.createdAt)
  const rightTime = Date.parse(right.createdAt)
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime
  }
  return left.id.localeCompare(right.id)
}

function compareTimelineRuns(
  left: ConversationTimelineRunSnapshot,
  right: ConversationTimelineRunSnapshot,
): number {
  const leftTime = Date.parse(left.triggerMessage?.createdAt ?? left.run.createdAt)
  const rightTime = Date.parse(right.triggerMessage?.createdAt ?? right.run.createdAt)
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime
  }
  return left.run.id.localeCompare(right.run.id)
}

function getPersistedMessageOrderSequence(message: PersistedMessage): number {
  if (typeof message.firstEventSequence === 'number') {
    return message.firstEventSequence
  }
  if (message.role === 'user') {
    return 0
  }
  return Number.MAX_SAFE_INTEGER
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : undefined
}

function buildRuntimeRunInput(
  conversation: ConversationDetailOutput,
  userContent: string,
  history: RuntimeMessage[],
): RuntimeRunInput {
  const workspace = getRuntimeWorkspace(conversation.metadataJson)

  return {
    conversationId: conversation.id,
    mode: conversation.mode as 'single' | 'group',
    participantAgentIds: conversation.agents.map((agent) => agent.agentId),
    addressedAgentIds: [],
    userMessage: {
      role: 'user',
      content: userContent,
    },
    history,
    conversationState: {
      messageCountBeforeRun: history.length,
      titleSource: getTitleSource(conversation.metadataJson),
    },
    diagnostics: {
      includeModelStream: false,
      includeReasoning: true,
      includeRawModelChunks: false,
    },
    ...(workspace ? { workspace } : {}),
  }
}

function projectMessagesToRuntimeHistory(records: unknown[]): RuntimeMessage[] {
  return records.flatMap((record) => {
    const message = toPersistedMessage(record as Record<string, unknown>)
    if (message.surface !== 'chat') return []
    if (message.role !== 'user' && message.role !== 'assistant') return []
    const content = message.parts
      .filter((part) => part.type === 'text' && part.text)
      .map((part) => part.text)
      .join('\n')
      .trim()
    if (!content) return []
    return [{
      id: message.id,
      role: message.role as RuntimeMessage['role'],
      agentId: message.agentId ?? undefined,
      content,
    }]
  })
}

function safeJsonParse(value: string | undefined, fallback: unknown = {}): unknown {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function toPersistedMessage(record: Record<string, unknown>): PersistedMessage {
  const parts = ((record.parts as Record<string, unknown>[] | undefined) ?? [])
    .map((part) => ({
      ...part,
      payloadJson: safeJsonParse(part.payloadJson as string | undefined, {}),
    })) as PersistedMessagePart[]

  return {
    ...record,
    metadataJson: safeJsonParse(record.metadataJson as string | undefined, {}),
    uiMessageJson: record.uiMessageJson ? safeJsonParse(record.uiMessageJson as string, null) : null,
    parts,
  } as PersistedMessage
}

function toHubEnvelope(event: RunEventOutput): HubRunEventEnvelope[] {
  const runtimeEvent = (event.payloadJson as { event?: RuntimeRunEvent }).event
  if (!runtimeEvent) return []
  return [{ sequence: event.sequence, event: runtimeEvent }]
}

async function* readSseRuntimeEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<RuntimeRunEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split(/\r?\n\r?\n/)
      buffer = chunks.pop() ?? ''
      for (const chunk of chunks) {
        const event = parseSseRuntimeEvent(chunk)
        if (event) yield event
      }
    }
    const tail = parseSseRuntimeEvent(buffer)
    if (tail) yield tail
  } finally {
    reader.releaseLock()
  }
}

function parseSseRuntimeEvent(chunk: string): RuntimeRunEvent | null {
  const dataLines = chunk
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
  if (!dataLines.length) return null
  return JSON.parse(dataLines.join('\n')) as RuntimeRunEvent
}

function getRuntimeWorkspace(metadata: Record<string, unknown>) {
  const workspace = metadata.workspace
  if (typeof workspace !== 'object' || workspace === null) return undefined
  const snapshot = workspace as Record<string, unknown>
  if (
    typeof snapshot.workspaceId !== 'string' ||
    snapshot.backendType !== 'local' ||
    typeof snapshot.rootPath !== 'string'
  ) {
    return undefined
  }
  return {
    workspaceId: snapshot.workspaceId,
    backendType: 'local' as const,
    rootPath: snapshot.rootPath,
  }
}

function getTitleSource(metadata: Record<string, unknown>): 'default' | 'auto' | 'manual' {
  const source = metadata.titleSource
  return source === 'auto' || source === 'manual' ? source : 'default'
}

function getEventDataRecord(event: RuntimeRunEvent): Record<string, unknown> {
  return typeof event.data === 'object' && event.data !== null
    ? event.data as Record<string, unknown>
    : {}
}

function extractPlan(event: RuntimeRunEvent): Record<string, unknown> | null {
  const data = getEventDataRecord(event)
  const nested = typeof data.data === 'object' && data.data !== null
    ? data.data as Record<string, unknown>
    : {}
  const plan = nested.plan
  return typeof plan === 'object' && plan !== null
    ? plan as Record<string, unknown>
    : null
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function normalizeRuntimeError(data: unknown): Record<string, unknown> {
  return typeof data === 'object' && data !== null
    ? data as Record<string, unknown>
    : { message: 'Runtime run creation failed' }
}

function getRuntimeErrorMessage(data: unknown): string {
  const record = normalizeRuntimeError(data)
  const nested = record.error
  if (typeof nested === 'object' && nested !== null) {
    const message = (nested as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  if (typeof record.message === 'string') return record.message
  return 'Runtime run creation failed'
}
