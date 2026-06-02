import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { AppError, notFound } from '../lib/errors'
import type { RuntimeClient } from '../lib/runtime'
import { logger } from '../lib/logger'
import type { RunStatus, MessageSurface, PermissionType, MetadataJson } from '../lib/types'
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
  findRunByRuntimeId,
  listRuns,
  updateRun,
  type RunOutput,
} from '../repositories/run.repo'
import {
  createRunEvents,
  findRunEventsByIds,
  getLastRunEventSequence,
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
import {
  findExternalAgentSessionHint,
  listExternalAgentSessions,
  patchExternalAgentSessionMetadata,
  upsertExternalAgentSession,
  type ExternalAgentSessionOutput,
  type ExternalSessionScope,
} from '../repositories/external-agent-session.repo'
import {
  createArtifact,
  findArtifactByRunAndSourceEvent,
  listArtifactsByMessageIds,
  updateArtifact,
} from '../repositories/artifact.repo'
import { createArtifactVersion } from '../repositories/artifact-version.repo'
import type { HubEventBus } from './hub-event-bus.service'
import { loadSettings } from '../routers/settings'

export type RuntimeRunEvent = {
  id: string
  runId: string
  runtimeRunId?: string | null
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

type RuntimeExternalSessionHint = {
  provider: 'opencode' | 'claude-code' | 'codex'
  agentId: string
  scope: ExternalSessionScope
  providerSessionId: string
  conversationId?: string
  workspaceId?: string
  parentProviderSessionId?: string
  taskId?: string
  runId?: string
  handoffSummary?: string
}

type RuntimeExternalContextMessage = {
  id: string
  role: 'user' | 'assistant'
  agentId?: string
  senderLabel?: string
  createdAt?: string
  content: string
}

type RuntimeExternalContextHandoffSummary = {
  sessionId?: string
  providerSessionId: string
  taskId?: string
  runId?: string
  summary: string
}

type RuntimeExternalContextPacket = {
  provider: 'opencode' | 'claude-code' | 'codex'
  agentId: string
  scope: ExternalSessionScope
  mode: 'delta' | 'bootstrap'
  messages: RuntimeExternalContextMessage[]
  handoffSummaries: RuntimeExternalContextHandoffSummary[]
  cursorCandidate?: {
    throughMessageId?: string
    throughMessageCreatedAt?: string
    includedMessageIds: string[]
    includedHandoffSessionIds: string[]
  }
  omitted?: {
    messageCount?: number
    characterCount?: number
    handoffSummaryCount?: number
  }
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
    titleSeedUserMessage?: string
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
  externalSessionHints?: RuntimeExternalSessionHint[]
  externalContext?: RuntimeExternalContextPacket[]
}

type RuntimeRunCreateResponse = {
  runId: string
  status: RunStatus
  entryAgentIds: string[]
  entryReason: string
  eventsUrl: string
}

export type SendMessageOptions = {
  addressedAgentIds?: string[]
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

export type PersistedArtifactVersion = {
  id: string
  artifactId: string
  version: number
  source: string
  language: string | null
  content: string
  summary: string | null
  diffJson: Record<string, unknown> | null
  createdByAgentId: string | null
  createdAt: string
}

export type PersistedArtifact = {
  id: string
  conversationId: string
  runId: string | null
  messageId: string | null
  createdByAgentId: string | null
  type: string
  title: string
  status: string
  currentVersionId: string | null
  metadataJson: Record<string, unknown>
  createdAt: string
  updatedAt: string
  currentVersion?: PersistedArtifactVersion | null
}

export type PersistedMessage = MessageOutput & {
  parts: PersistedMessagePart[]
  artifacts?: PersistedArtifact[]
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

type SequencedRuntimeEvent = {
  event: RuntimeRunEvent
  sequence: number
}

type RuntimeEventPersistenceState = {
  run: RunOutput
  nextSequence: number
  seenEventIds: Set<string>
}

type RawBatchFlushResult = {
  envelopes: HubRunEventEnvelope[]
  sequencedEvents: SequencedRuntimeEvent[]
}

type RuntimeEventBatcherOptions<T> = {
  flushIntervalMs: number
  maxBatchSize: number
  maxBufferedItems: number
  flush: (items: T[]) => Promise<void>
}

export class RuntimeEventBatcher<T> {
  private buffer: T[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private flushPromise: Promise<void> | null = null
  private flushError: unknown = null

  constructor(private options: RuntimeEventBatcherOptions<T>) {}

  async enqueue(item: T, opts?: { forceFlush?: boolean }): Promise<void> {
    if (this.flushError) {
      throw this.flushError
    }

    this.buffer.push(item)

    if (opts?.forceFlush || this.buffer.length >= this.options.maxBatchSize) {
      await this.flush()
      return
    }

    if (this.buffer.length >= this.options.maxBufferedItems) {
      await this.flush()
      return
    }

    if (!this.timer) {
      this.timer = setTimeout(() => {
        void this.flush().catch((error) => {
          this.flushError = error
        })
      }, this.options.flushIntervalMs)
    }
  }

  async flush(): Promise<void> {
    if (this.flushError) {
      throw this.flushError
    }

    if (this.flushPromise) {
      await this.flushPromise
    }

    if (this.flushError) {
      throw this.flushError
    }

    if (!this.buffer.length) {
      this.clearTimer()
      return
    }

    const items = this.buffer
    this.buffer = []
    this.clearTimer()

    this.flushPromise = this.options.flush(items)
      .catch((error) => {
        this.flushError = error
        throw error
      })
      .finally(() => {
        this.flushPromise = null
      })

    await this.flushPromise
  }

  async close(): Promise<void> {
    this.clearTimer()
    await this.flush()
  }

  private clearTimer(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }
}

const RAW_EVENT_FLUSH_INTERVAL_MS = 50
const RAW_EVENT_MAX_BATCH_SIZE = 50
const RAW_EVENT_MAX_BUFFERED_ITEMS = 500
const PROJECTION_FLUSH_INTERVAL_MS = 150
const PROJECTION_MAX_BATCH_SIZE = 100
const PROJECTION_MAX_BUFFERED_ITEMS = 500
const RUNTIME_EVENT_STREAM_MAX_RETRIES = 2
const RUNTIME_EVENT_STREAM_RETRY_DELAY_MS = 250
const BASH_OUTPUT_UI_PREVIEW_CHARS = 12_000
const OPENCODE_EXTERNAL_CONTEXT_MAX_MESSAGES = 50
const OPENCODE_EXTERNAL_CONTEXT_MAX_CHARS = 12_000
const OPENCODE_EXTERNAL_CONTEXT_MAX_MESSAGE_CHARS = 4_000
const OPENCODE_EXTERNAL_CONTEXT_MAX_HANDOFFS = 5
const runPersistenceLogger = logger.child({ module: 'run-persistence' })

export class RunPersistenceService {
  private consumers = new Map<string, AbortController>()
  private listeners = new Map<string, Set<RunListener>>()
  private projectionBatchers = new Map<string, RuntimeEventBatcher<SequencedRuntimeEvent>>()

  constructor(
    private runtimeClient: RuntimeClient,
    private hubEventBus: HubEventBus,
  ) {}

  async sendMessage(
    conversationId: string,
    content: string,
    options: SendMessageOptions = {},
  ): Promise<ConversationMessagesResponse> {
    const trimmed = content.trim()
    if (!trimmed) {
      throw new AppError(400 as ContentfulStatusCode, 'MESSAGE_EMPTY', 'Message content is empty')
    }

    const conversation = await findConversationWithAgents(conversationId)
    if (!conversation) {
      throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')
    }
    const addressedAgentIds = resolveAddressedAgentIds(
      conversation,
      options.addressedAgentIds,
    )
    const isOpenCodeRun = resolveDirectExternalAgentId(conversation, addressedAgentIds) === 'opencode'
    if (isOpenCodeRun) {
      runPersistenceLogger.info({
        externalProvider: 'opencode',
        conversationId,
        mode: conversation.mode,
        participantAgentIds: conversation.agents.map((agent) => agent.agentId),
        addressedAgentIds,
        contentLength: trimmed.length,
      }, 'OpenCode Hub send request accepted')
    }
    await this.ensureConversationProjectionCaughtUp(conversationId)

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
    if (isOpenCodeRun) {
      runPersistenceLogger.info({
        externalProvider: 'opencode',
        conversationId,
        userMessageId: userMessage.id,
        userMessagePartId: userMessagePart.id,
        contentLength: trimmed.length,
      }, 'OpenCode user message persisted')
    }
    await updateConversation(conversationId, {
      lastMessageId: userMessage.id,
      lastMessageAt: userMessage.createdAt,
    })
    this.publishConversationLastMessageUpdated({
      conversationId,
      runId: null,
      lastMessageId: userMessage.id,
      lastMessageAt: userMessage.createdAt,
      lastMessageContent: trimmed,
    })

    const run = await createRun({
      conversationId,
      triggerMessageId: userMessage.id,
      mode: conversation.mode as 'single' | 'group',
      status: 'queued',
      orchestratorAgentId: conversation.orchestratorAgentId ?? undefined,
    })
    this.publishRunStatusChanged(run, 'queued')
    await updateMessage(userMessage.id, { runId: run.id })
    await updateMessagePart(userMessagePart.id, { runId: run.id })
    if (isOpenCodeRun) {
      runPersistenceLogger.info({
        externalProvider: 'opencode',
        conversationId,
        runId: run.id,
        triggerMessageId: userMessage.id,
      }, 'OpenCode local run created')
    }

    const directOpenCodeSession = await resolveDirectOpenCodeSession(
      conversation,
      addressedAgentIds,
    )
    const externalSessionHints = directOpenCodeSession
      ? [toRuntimeExternalSessionHint(directOpenCodeSession)]
      : []
    const externalContext = await resolveExternalContextPackets(
      conversation,
      addressedAgentIds,
      historyMessages,
      directOpenCodeSession,
    )
    if (isOpenCodeRun) {
      runPersistenceLogger.info({
        externalProvider: 'opencode',
        conversationId,
        runId: run.id,
        externalSessionHintCount: externalSessionHints.length,
        providerSessionIds: externalSessionHints.map((hint) => hint.providerSessionId),
        externalContextPacketCount: externalContext.length,
        externalContextMessageCount: externalContext.reduce((sum, packet) => sum + packet.messages.length, 0),
        externalContextHandoffCount: externalContext.reduce((sum, packet) => sum + packet.handoffSummaries.length, 0),
        externalContextModes: externalContext.map((packet) => packet.mode),
      }, 'OpenCode external session hints resolved')
    }
    const input = buildRuntimeRunInput(
      conversation,
      trimmed,
      history,
      addressedAgentIds,
      externalSessionHints,
      externalContext,
      userMessage.id,
    )
    await updateRun(run.id, { inputJson: input })

    const response = await this.runtimeClient.forward('POST', '/runtime/runs', input, { raw: true })
    if (response.status < 200 || response.status >= 300) {
      await updateRun(run.id, {
        status: 'failed',
        errorJson: normalizeRuntimeError(response.data),
        completedAt: new Date().toISOString(),
      })
      this.publishRunStatusChanged(run, 'failed')
      this.publishTerminalRunStatus(run, 'failed')
      if (isOpenCodeRun) {
        runPersistenceLogger.error({
          externalProvider: 'opencode',
          conversationId,
          runId: run.id,
          status: response.status,
          error: normalizeRuntimeError(response.data),
        }, 'OpenCode Runtime run creation failed')
      }
      throw new AppError(response.status as ContentfulStatusCode, 'RUNTIME_RUN_CREATE_FAILED', getRuntimeErrorMessage(response.data))
    }

    const runtimeRun = response.data as RuntimeRunCreateResponse
    await updateRun(run.id, {
      runtimeId: runtimeRun.runId,
      status: runtimeRun.status,
    })
    this.publishRunStatusChanged(
      { ...run, runtimeId: runtimeRun.runId },
      runtimeRun.status,
    )
    if (isOpenCodeRun) {
      runPersistenceLogger.info({
        externalProvider: 'opencode',
        conversationId,
        runId: run.id,
        runtimeRunId: runtimeRun.runId,
        status: runtimeRun.status,
        eventsUrl: runtimeRun.eventsUrl,
      }, 'OpenCode Runtime run created')
    }
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
    await this.ensureConversationProjectionCaughtUp(conversationId)

    const page = {
      limit: opts?.limit ?? 50,
      offset: opts?.offset ?? 0,
    }
    const messages = await listMessagesWithParts(conversationId, {
      ...page,
      order: 'desc',
    })
    const activeRun = await this.findActiveRun(conversationId)
    const activeRunSnapshot = activeRun
      ? await this.toActiveRunSnapshot(activeRun)
      : null
    const latestPlanRun = await findLatestRunPlanByConversation(conversationId)
    const latestPlanRunRecord = latestPlanRun ? await findRunById(latestPlanRun.runId) : null
    const runItems = await this.listConversationRunItems(conversationId)
    const timelineRuns = await this.listConversationTimelineRuns(conversationId, page)

    const persistedMessages = await attachArtifactsToMessages(
      messages.map(toPersistedMessage).sort(comparePersistedMessages),
    )

    return {
      messages: persistedMessages,
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
    const run = await findRunById(runId) ?? await findRunByRuntimeId(runId)
    if (!run) {
      throw notFound('RUN_NOT_FOUND', 'Run 不存在')
    }
    if (this.isTerminalRunStatus(run.status)) {
      return this.toActiveRunSnapshot(run)
    }

    const runtimeId = run.runtimeId
    if (!runtimeId) {
      return this.cancelLocalRun(run)
    }

    let response: Awaited<ReturnType<RuntimeClient['forward']>>
    try {
      response = await this.runtimeClient.forward(
        'POST',
        `/runtime/runs/${encodeURIComponent(runtimeId)}/cancel`,
        undefined,
        { raw: true },
      )
    } catch (error) {
      if (isAbandonableRuntimeCancelError(error)) {
        return this.cancelLocalRun(run)
      }
      throw error
    }

    if (response.status < 200 || response.status >= 300) {
      const code = getRuntimeErrorCode(response.data)
      if (isAbandonableRuntimeCancelFailure(response.status, code)) {
        return this.cancelLocalRun(run)
      }

      throw new AppError(
        response.status as ContentfulStatusCode,
        code ?? 'RUN_CANCEL_FAILED',
        getRuntimeErrorMessage(response.data),
      )
    }

    const nextStatus = getTerminalRunStatusFromRuntimeResponse(response.data) ?? 'cancelled'
    const completedAt = new Date().toISOString()
    const latestBeforeUpdate = await findRunById(run.id) ?? run
    if (!this.isTerminalRunStatus(latestBeforeUpdate.status)) {
      const latest = await updateRun(run.id, { status: nextStatus, completedAt })
      await finalizeRunProjection(run.id, nextStatus, completedAt)
      this.publishRunStatusChanged(latest, nextStatus)
      this.publishTerminalRunStatus(latest, nextStatus)
      return this.toActiveRunSnapshot(latest)
    }

    const latest = await findRunById(run.id)
    return this.toActiveRunSnapshot(latest)
  }

  private async cancelLocalRun(run: RunOutput): Promise<ActiveRunSnapshot> {
    const latest = await findRunById(run.id) ?? run
    if (this.isTerminalRunStatus(latest.status)) {
      return this.toActiveRunSnapshot(latest)
    }

    const completedAt = new Date().toISOString()
    const cancelled = await updateRun(run.id, { status: 'cancelled', completedAt })
    await finalizeRunProjection(run.id, 'cancelled', completedAt)
    this.publishRunStatusChanged(cancelled, 'cancelled')
    this.publishTerminalRunStatus(cancelled, 'cancelled')
    return this.toActiveRunSnapshot(cancelled)
  }

  async decidePermission(
    runId: string,
    requestId: string,
    approved: boolean,
    reason?: string,
  ): Promise<unknown> {
    const run = await findRunById(runId) ?? await findRunByRuntimeId(runId)
    if (!run) {
      throw notFound('RUN_NOT_FOUND', 'Run 不存在')
    }
    if (!run.runtimeId) {
      throw new AppError(409 as ContentfulStatusCode, 'PERMISSION_RUN_NOT_ACTIVE', 'Run 尚未绑定 Runtime 执行实例')
    }

    const response = await this.runtimeClient.forward(
      'POST',
      `/runtime/runs/${encodeURIComponent(run.runtimeId)}/permissions/${encodeURIComponent(requestId)}/decision`,
      { approved, reason },
      { raw: true },
    )
    if (response.status < 200 || response.status >= 300) {
      throw new AppError(
        response.status as ContentfulStatusCode,
        getRuntimeErrorCode(response.data) ?? 'PERMISSION_DECISION_FAILED',
        getRuntimeErrorMessage(response.data),
      )
    }

    return response.data
  }

  async answerQuestion(
    runId: string,
    requestId: string,
    answers: Array<{
      questionId: string
      optionId?: string
      answer?: string
      custom?: boolean
    }>,
  ): Promise<unknown> {
    const run = await findRunById(runId) ?? await findRunByRuntimeId(runId)
    if (!run) {
      throw notFound('RUN_NOT_FOUND', 'Run 不存在')
    }
    if (!run.runtimeId) {
      throw new AppError(409 as ContentfulStatusCode, 'QUESTION_RUN_NOT_ACTIVE', 'Run 尚未绑定 Runtime 执行实例')
    }

    const response = await this.runtimeClient.forward(
      'POST',
      `/runtime/runs/${encodeURIComponent(run.runtimeId)}/questions/${encodeURIComponent(requestId)}/answer`,
      { answers },
      { raw: true },
    )
    if (response.status < 200 || response.status >= 300) {
      throw new AppError(
        response.status as ContentfulStatusCode,
        getRuntimeErrorCode(response.data) ?? 'QUESTION_ANSWER_FAILED',
        getRuntimeErrorMessage(response.data),
      )
    }

    return response.data
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
    return events.flatMap(toProductHubEnvelope)
  }

  async ensureConversationProjectionCaughtUp(conversationId: string): Promise<void> {
    let offset = 0
    const pageSize = 100
    while (true) {
      const runs = await listRuns({ conversationId, limit: pageSize, offset, order: 'asc' })
      if (!runs.length) return
      for (const run of runs) {
        await this.ensureRunProjectionCaughtUp(run.id)
      }
      offset += runs.length
      if (runs.length < pageSize) return
    }
  }

  async getRunStatus(runId: string): Promise<RunStatus> {
    const run = await findRunById(runId)
    if (!run) {
      throw notFound('RUN_NOT_FOUND', 'Run 不存在')
    }
    return run.status
  }

  private async ensureRunProjectionCaughtUp(runId: string): Promise<void> {
    const activeBatcher = this.projectionBatchers.get(runId)
    if (activeBatcher) {
      await activeBatcher.flush()
    }

    const run = await findRunById(runId)
    if (!run) return
    const latestEventSequence = Math.max(
      run.lastEventSequence ?? 0,
      await getLastRunEventSequence(runId),
    )
    if ((run.lastProjectedSequence ?? 0) >= latestEventSequence) {
      return
    }

    const events = await listRunEventsByRunAfterSequence(runId, run.lastProjectedSequence ?? 0)
    const sequencedEvents = events.flatMap(toSequencedRuntimeEvent)
    await this.projectRuntimeEventsBatch(runId, sequencedEvents)
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
    const lastEventSequence = Math.max(
      run.lastEventSequence ?? 0,
      await getLastRunEventSequence(run.id),
    )
    return {
      id: run.id,
      runtimeId: run.runtimeId,
      status: run.status,
      lastEventSequence,
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
      order: 'desc',
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
            lastEventSequence: Math.max(
              run.lastEventSequence ?? 0,
              events[events.length - 1]?.sequence ?? 0,
            ),
          },
          triggerMessage: triggerMessageRecord
            ? toPersistedMessage(triggerMessageRecord as Record<string, unknown>)
            : null,
          events: events.flatMap(toProductHubEnvelope),
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
    const run = await findRunById(runId)
    if (!run) return
    const isOpenCodeRun = isRunForOpenCode(run)
    if (isOpenCodeRun) {
      runPersistenceLogger.info({
        externalProvider: 'opencode',
        conversationId: run.conversationId,
        runId,
        runtimeRunId,
      }, 'OpenCode Runtime event consumer starting')
    }

    const persistenceState: RuntimeEventPersistenceState = {
      run,
      nextSequence: run.lastEventSequence ?? 0,
      seenEventIds: new Set<string>(),
    }
    const projectionBatcher = new RuntimeEventBatcher<SequencedRuntimeEvent>({
      flushIntervalMs: PROJECTION_FLUSH_INTERVAL_MS,
      maxBatchSize: PROJECTION_MAX_BATCH_SIZE,
      maxBufferedItems: PROJECTION_MAX_BUFFERED_ITEMS,
      flush: async (items) => {
        await this.projectRuntimeEventsBatch(persistenceState.run.id, items)
      },
    })
    this.projectionBatchers.set(runId, projectionBatcher)
    const rawBatcher = new RuntimeEventBatcher<RuntimeRunEvent>({
      flushIntervalMs: RAW_EVENT_FLUSH_INTERVAL_MS,
      maxBatchSize: RAW_EVENT_MAX_BATCH_SIZE,
      maxBufferedItems: RAW_EVENT_MAX_BUFFERED_ITEMS,
      flush: async (items) => {
        const result = await this.persistRuntimeEventBatch(persistenceState, items)
        for (const envelope of result.envelopes) {
          this.publish(runId, envelope)
        }
        for (const item of result.sequencedEvents) {
          await projectionBatcher.enqueue(item, {
            forceFlush: this.isTerminalRunEvent(item.event),
          })
        }
      },
    })

    try {
      let retryCount = 0
      let reachedTerminal = false

      while (!reachedTerminal) {
        try {
          const response = await this.runtimeClient.stream(
            `/runtime/runs/${encodeURIComponent(runtimeRunId)}/events`,
            { signal: abortController.signal },
          )
          if (!response.ok || !response.body) {
            await this.failRuntimeConsumerRun(
              runId,
              `Runtime event stream failed (${response.status})`,
            )
            if (isOpenCodeRun) {
              runPersistenceLogger.error({
                externalProvider: 'opencode',
                conversationId: run.conversationId,
                runId,
                runtimeRunId,
                status: response.status,
              }, 'OpenCode Runtime event stream failed to open')
            }
            return
          }
          if (isOpenCodeRun) {
            runPersistenceLogger.info({
              externalProvider: 'opencode',
              conversationId: run.conversationId,
              runId,
              runtimeRunId,
              retryCount,
            }, 'OpenCode Runtime event stream connected')
          }

          for await (const event of readSseRuntimeEvents(response.body)) {
            await rawBatcher.enqueue(event, {
              forceFlush: this.isTerminalRunEvent(event),
            })
            if (this.isTerminalRunEvent(event)) {
              reachedTerminal = true
              break
            }
          }

          await rawBatcher.flush()
          await projectionBatcher.flush()
          if (reachedTerminal || await this.hasPersistedTerminalRunEvent(runId)) {
            break
          }

          if (retryCount >= RUNTIME_EVENT_STREAM_MAX_RETRIES) {
            throw new Error('Runtime event stream ended before terminal event')
          }

          retryCount += 1
          logger.warn(
            { runId, runtimeRunId, retryCount },
            'Runtime event stream ended before terminal event; retrying',
          )
          await delayRuntimeEventStreamRetry(retryCount)
        } catch (error) {
          if (abortController.signal.aborted) {
            break
          }

          try {
            await rawBatcher.flush()
            await projectionBatcher.flush()
          } catch (flushError) {
            logger.error({ err: flushError, runId, runtimeRunId }, 'Runtime event consumer flush failed')
            await this.failRuntimeConsumerRun(
              runId,
              flushError instanceof Error ? flushError.message : 'Runtime event consumer flush failed',
            )
            return
          }

          if (await this.hasPersistedTerminalRunEvent(runId)) {
            logger.warn(
              { err: error, runId, runtimeRunId },
              'Runtime event stream interrupted after terminal event was persisted',
            )
            break
          }

          if (
            isRetryableRuntimeEventStreamError(error) &&
            retryCount < RUNTIME_EVENT_STREAM_MAX_RETRIES
          ) {
            retryCount += 1
            logger.warn(
              { err: error, runId, runtimeRunId, retryCount },
              'Runtime event stream interrupted; retrying',
            )
            await delayRuntimeEventStreamRetry(retryCount)
            continue
          }

          logger.error({ err: error, runId, runtimeRunId }, 'Runtime event consumer failed')
          await this.failRuntimeConsumerRun(
            runId,
            error instanceof Error ? error.message : 'Runtime event consumer failed',
          )
          return
        }
      }
    } finally {
      try {
        await rawBatcher.close()
        await projectionBatcher.close()
      } catch (error) {
        logger.error({ err: error, runId, runtimeRunId }, 'Runtime event consumer flush failed')
      }
      this.projectionBatchers.delete(runId)
      this.consumers.delete(runId)
      if (isOpenCodeRun) {
        runPersistenceLogger.info({
          externalProvider: 'opencode',
          conversationId: run.conversationId,
          runId,
          runtimeRunId,
        }, 'OpenCode Runtime event consumer stopped')
      }
    }
  }

  private async hasPersistedTerminalRunEvent(runId: string): Promise<boolean> {
    const events = await listRunEventsByRun(runId)
    return events.some(isPersistedTerminalRuntimeEvent)
  }

  private async failRuntimeConsumerRun(runId: string, message: string): Promise<void> {
    const latest = await findRunById(runId)
    if (!latest || this.isTerminalRunStatus(latest.status)) {
      return
    }

    const failedRun = await updateRun(runId, {
      status: 'failed',
      errorJson: { message },
      completedAt: new Date().toISOString(),
    })
    this.publishRunStatusChanged(failedRun, 'failed')
    this.publishTerminalRunStatus(failedRun, 'failed')
  }

  private async persistRuntimeEventBatch(
    state: RuntimeEventPersistenceState,
    events: RuntimeRunEvent[],
  ): Promise<RawBatchFlushResult> {
    const uniqueEvents: RuntimeRunEvent[] = []
    const idsInBatch = new Set<string>()
    for (const event of events) {
      if (state.seenEventIds.has(event.id) || idsInBatch.has(event.id)) {
        continue
      }
      idsInBatch.add(event.id)
      uniqueEvents.push(event)
    }

    if (!uniqueEvents.length) {
      return { envelopes: [], sequencedEvents: [] }
    }

    const existingEvents = await findRunEventsByIds(uniqueEvents.map((event) => event.id))
    const existingIds = new Set(existingEvents.map((event) => event.id))
    const newEvents = uniqueEvents.filter((event) => !existingIds.has(event.id))

    for (const event of existingEvents) {
      state.seenEventIds.add(event.id)
    }

    if (!newEvents.length) {
      return { envelopes: [], sequencedEvents: [] }
    }

    const sequencedEvents = newEvents.map((event) => {
      state.nextSequence += 1
      return { event, sequence: state.nextSequence }
    })

    const stored = await createRunEvents(sequencedEvents.map(({ event, sequence }) => ({
      id: event.id,
      runId: state.run.id,
      runtimeRunId: event.runId,
      conversationId: state.run.conversationId,
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
    })))

    const latestSequence = sequencedEvents[sequencedEvents.length - 1]?.sequence ?? state.run.lastEventSequence
    state.run = await updateRun(state.run.id, { lastEventSequence: latestSequence })
    for (const event of newEvents) {
      state.seenEventIds.add(event.id)
    }
    if (isRunForOpenCode(state.run) || newEvents.some(isOpenCodeEvent)) {
      const terminalEvent = newEvents.find((event) => this.isTerminalRunEvent(event))
      runPersistenceLogger.debug({
        externalProvider: 'opencode',
        conversationId: state.run.conversationId,
        runId: state.run.id,
        runtimeRunId: state.run.runtimeId,
        persistedEventCount: stored.length,
        eventTypes: newEvents.map((event) => event.type),
        lastSequence: latestSequence,
        terminalEventType: terminalEvent?.type,
      }, 'OpenCode Runtime events persisted')
    }

    return {
      envelopes: stored.flatMap(toHubEnvelope),
      sequencedEvents,
    }
  }

  private async projectRuntimeEventsBatch(
    runId: string,
    items: SequencedRuntimeEvent[],
  ): Promise<void> {
    if (!items.length) return

    const run = await findRunById(runId)
    if (!run) return

    const orderedItems = [...items].sort((left, right) => left.sequence - right.sequence)
    const pendingMessageDeltas = new Map<string, SequencedRuntimeEvent[]>()
    const pendingReasoningDeltas = new Map<string, SequencedRuntimeEvent[]>()

    const flushMessageDeltas = async (key?: string): Promise<void> => {
      const entries = key
        ? [[key, pendingMessageDeltas.get(key) ?? []] as const]
        : [...pendingMessageDeltas.entries()]
      for (const [entryKey, events] of entries) {
        if (!events.length) continue
        pendingMessageDeltas.delete(entryKey)
        await projectRuntimeMessageDeltaEvents(run, events)
      }
    }

    const flushReasoningDeltas = async (key?: string): Promise<void> => {
      const entries = key
        ? [[key, pendingReasoningDeltas.get(key) ?? []] as const]
        : [...pendingReasoningDeltas.entries()]
      for (const [entryKey, events] of entries) {
        if (!events.length) continue
        pendingReasoningDeltas.delete(entryKey)
        await projectReasoningDeltaEvents(run, events)
      }
    }

    for (const item of orderedItems) {
      const { event } = item
      if (event.type === 'message.delta') {
        const key = getMessageProjectionKey(event)
        const existing = pendingMessageDeltas.get(key) ?? []
        existing.push(item)
        pendingMessageDeltas.set(key, existing)
        continue
      }

      if (event.type === 'reasoning.delta') {
        const key = getReasoningProjectionKey(event)
        const existing = pendingReasoningDeltas.get(key) ?? []
        existing.push(item)
        pendingReasoningDeltas.set(key, existing)
        continue
      }

      if (event.type === 'message.completed') {
        await flushMessageDeltas(getMessageProjectionKey(event))
      } else if (event.type === 'reasoning.completed') {
        await flushReasoningDeltas()
      } else if (this.isTerminalRunEvent(event)) {
        await flushMessageDeltas()
        await flushReasoningDeltas()
      }

      await this.projectRuntimeEvent(run, event, item.sequence)
    }

    await flushMessageDeltas()
    await flushReasoningDeltas()

    const latestSequence = orderedItems[orderedItems.length - 1]?.sequence
    if (latestSequence !== undefined) {
      await updateRun(runId, { lastProjectedSequence: latestSequence })
    }
  }

  private async projectRuntimeEvent(
    run: RunOutput,
    event: RuntimeRunEvent,
    sequence: number,
  ): Promise<void> {
    const runId = run.id
    const timestamp = event.timestamp ?? new Date().toISOString()

    if (event.type === 'run.started') {
      await this.updateActiveRunStatus(run, 'running', { startedAt: timestamp })
      return
    }
    if (event.type === 'run.completed') {
      await projectWorkspaceDiffArtifact(run, event)
      await updateRun(runId, { status: 'completed', completedAt: timestamp })
      await finalizeRunProjection(runId, 'completed', timestamp)
      this.publishRunStatusChanged(run, 'completed')
      this.publishTerminalRunStatus(run, 'completed')
      return
    }
    if (event.type === 'run.failed') {
      await projectWorkspaceDiffArtifact(run, event)
      await updateRun(runId, {
        status: 'failed',
        errorJson: getEventDataRecord(event),
        completedAt: timestamp,
      })
      await finalizeRunProjection(runId, 'failed', timestamp)
      this.publishRunStatusChanged(run, 'failed')
      this.publishTerminalRunStatus(run, 'failed')
      return
    }
    if (event.type === 'run.cancelled') {
      await projectWorkspaceDiffArtifact(run, event)
      await updateRun(runId, { status: 'cancelled', completedAt: timestamp })
      await finalizeRunProjection(runId, 'cancelled', timestamp)
      this.publishRunStatusChanged(run, 'cancelled')
      this.publishTerminalRunStatus(run, 'cancelled')
      return
    }
    if (event.type === 'agent.started') {
      await projectExternalAgentSessionEvent(run, event)
      return
    }
    if (event.type === 'agent.completed') {
      await projectExternalAgentSessionEvent(run, event)
      await projectExternalContextSyncEvent(run, event)
      return
    }
    if (event.type === 'permission.requested') {
      await this.updateActiveRunStatus(run, 'waiting_approval')
      await projectPermissionEvent(run, event, sequence)
      return
    }
    if (
      event.type === 'permission.approved' ||
      event.type === 'permission.denied' ||
      event.type === 'permission.cancelled'
    ) {
      await this.updateActiveRunStatus(run, 'running')
      await projectPermissionEvent(run, event, sequence)
      return
    }
    if (event.type === 'question.requested') {
      await this.updateActiveRunStatus(run, 'waiting_input')
      return
    }
    if (event.type === 'question.answered' || event.type === 'question.cancelled') {
      await this.updateActiveRunStatus(run, 'running')
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
    if (event.type === 'system_agent.completed') {
      await projectSystemAgentCompletedEvent(run, event, this.hubEventBus)
      return
    }
    if (event.type === 'reasoning.started' || event.type === 'reasoning.delta' || event.type === 'reasoning.completed') {
      await projectReasoningEvent(run, event, sequence)
      return
    }
    if (event.type === 'message.delta' || event.type === 'message.completed') {
      await projectRuntimeMessageEvent(run, event, sequence, this.hubEventBus)
      return
    }
  }

  private async updateActiveRunStatus(
    run: RunOutput,
    status: RunStatus,
    patch: { startedAt?: string | null } = {},
  ): Promise<void> {
    const latest = await findRunById(run.id)
    if (!latest || this.isTerminalRunStatus(latest.status)) {
      return
    }

    if (latest.status === status && patch.startedAt === undefined) {
      return
    }

    const updated = await updateRun(run.id, { status, ...patch })
    if (latest.status !== status) {
      this.publishRunStatusChanged(updated, status)
    }
  }

  private isTerminalRunEvent(event: RuntimeRunEvent): boolean {
    return isTerminalRuntimeEventType(event.type)
  }

  private publish(runId: string, envelope: HubRunEventEnvelope): void {
    const listeners = this.listeners.get(runId)
    if (!listeners) return
    for (const listener of listeners) {
      listener(envelope)
    }
  }

  private publishRunStatusChanged(run: RunOutput, status: RunStatus): void {
    this.hubEventBus.publish('run.status.changed', {
      conversationId: run.conversationId,
      runId: run.id,
      runtimeRunId: run.runtimeId,
      status,
    })
  }

  private publishTerminalRunStatus(
    run: RunOutput,
    status: 'completed' | 'failed' | 'cancelled',
  ): void {
    this.hubEventBus.publish(`run.${status}`, {
      conversationId: run.conversationId,
      runId: run.id,
      runtimeRunId: run.runtimeId,
      status,
    })
  }

  private publishConversationLastMessageUpdated(input: {
    conversationId: string
    runId: string | null
    lastMessageId: string
    lastMessageAt: string
    lastMessageContent: string
  }): void {
    this.hubEventBus.publish('conversation.last_message.updated', {
      conversationId: input.conversationId,
      runId: input.runId,
      lastMessageId: input.lastMessageId,
      lastMessageAt: input.lastMessageAt,
      lastMessageContent: truncatePreview(input.lastMessageContent),
    })
  }
}

async function projectRuntimeMessageEvent(
  run: RunOutput,
  event: RuntimeRunEvent,
  sequence: number,
  hubEventBus: HubEventBus,
): Promise<void> {
  const runtimeMessageId = resolveRuntimeMessageId(event)
  const messageId = resolveLocalMessageId(run.id, runtimeMessageId)
  const surface = resolveMessageSurface(run, event)
  const data = getEventDataRecord(event)
  const text = event.type === 'message.delta'
    ? getString(data.delta)
    : getString(data.content)
  const externalModel = event.type === 'message.completed'
    ? getExternalModelFromEvent(event)
    : undefined

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
  if (textPart && (textPart.lastEventSequence ?? 0) >= sequence) {
    return
  }
  let persistedText = text ?? ''
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
    persistedText = nextText
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
      ...(externalModel ? { externalModel } : {}),
    }),
  })

  if (surface === 'chat') {
    await updateConversation(run.conversationId, {
      lastMessageId: message.id,
      lastMessageAt: event.timestamp,
    })
    if (event.type === 'message.completed') {
      if (event.agentId === 'opencode') {
        runPersistenceLogger.info({
          externalProvider: 'opencode',
          conversationId: run.conversationId,
          runId: run.id,
          runtimeRunId: event.runId,
          runtimeMessageId,
          messageId: message.id,
          sequence,
          contentLength: persistedText.length,
          externalModel,
        }, 'OpenCode assistant message projected')
      }
      hubEventBus.publish('conversation.last_message.updated', {
        conversationId: run.conversationId,
        runId: run.id,
        lastMessageId: message.id,
        lastMessageAt: event.timestamp,
        lastMessageContent: truncatePreview(persistedText),
      })
    }
  }
}

async function projectExternalAgentSessionEvent(
  run: RunOutput,
  event: RuntimeRunEvent,
): Promise<void> {
  const data = getEventDataRecord(event)
  const externalSession = data.externalSession
  if (typeof externalSession !== 'object' || externalSession === null) return

  const link = externalSession as Record<string, unknown>
  const provider = typeof link.provider === 'string' ? link.provider : null
  const providerSessionId = typeof link.providerSessionId === 'string' ? link.providerSessionId : null
  const agentId = typeof link.agentId === 'string' ? link.agentId : event.agentId
  const conversationId = typeof link.conversationId === 'string' ? link.conversationId : run.conversationId
  const workspaceIdentity = typeof link.workspaceId === 'string' ? link.workspaceId : null
  const scope = typeof link.scope === 'string' && isExternalSessionScope(link.scope) ? link.scope : null

  if (!provider || !providerSessionId || !agentId || !workspaceIdentity || !scope) {
    logger.warn({
      runId: run.id,
      runtimeRunId: event.runId,
      eventId: event.id,
      agentId: event.agentId,
    }, 'Skipping invalid external session link')
    return
  }

  await upsertExternalAgentSession({
    provider,
    agentId,
    conversationId,
    workspaceIdentity,
    scope,
    providerSessionId,
    parentProviderSessionId: typeof link.parentProviderSessionId === 'string'
      ? link.parentProviderSessionId
      : null,
    runId: run.id,
    taskId: typeof link.taskId === 'string' ? link.taskId : event.taskId ?? null,
    handoffSummary: typeof link.handoffSummary === 'string' ? link.handoffSummary : null,
    lastSyncedRunEventId: event.id,
    metadataJson: {
      runtimeRunId: event.runId,
      runtimeAgentId: event.agentId ?? null,
      providerRunId: typeof link.runId === 'string' ? link.runId : null,
    },
  })
  if (provider === 'opencode') {
    runPersistenceLogger.info({
      externalProvider: 'opencode',
      conversationId,
      runId: run.id,
      runtimeRunId: event.runId,
      eventId: event.id,
      agentId,
      providerSessionId,
      workspaceIdentity,
      scope,
    }, 'OpenCode external session link projected')
  }
}

async function projectExternalContextSyncEvent(
  run: RunOutput,
  event: RuntimeRunEvent,
): Promise<void> {
  const data = getEventDataRecord(event)
  if (getString(data.status) !== 'completed') return

  const externalContext = getRecord(data.externalContext)
  if (!externalContext) return

  const externalSession = getRecord(data.externalSession)
  const provider = getString(externalSession?.provider) ?? getString(externalContext.provider)
  const providerSessionId = getString(externalSession?.providerSessionId)
  if (provider !== 'opencode' || !providerSessionId) return

  const latestVisibleMessage = await findLatestVisibleContextMessage(run.conversationId)
  const cursorCandidate = getRecord(externalContext.cursorCandidate)
  const includedMessageIds = getStringArray(cursorCandidate?.includedMessageIds)
  const includedHandoffSessionIds = getStringArray(cursorCandidate?.includedHandoffSessionIds)
  const omitted = getRecord(externalContext.omitted)
  const contextBridge = {
    ...(latestVisibleMessage ? {
      lastSyncedMessageId: latestVisibleMessage.id,
      lastSyncedMessageCreatedAt: latestVisibleMessage.createdAt,
    } : {}),
    lastSyncedAt: event.timestamp,
    syncedAt: new Date().toISOString(),
    runId: run.id,
    runtimeRunId: event.runId,
    mode: getString(externalContext.mode) ?? null,
    includedMessageIds,
    includedHandoffSessionIds,
    ...(omitted ? { omitted } : {}),
  }

  await patchExternalAgentSessionMetadata({
    provider,
    providerSessionId,
  }, {
    contextBridge,
  })

  runPersistenceLogger.info({
    externalProvider: 'opencode',
    conversationId: run.conversationId,
    runId: run.id,
    runtimeRunId: event.runId,
    providerSessionId,
    contextMode: contextBridge.mode,
    lastSyncedMessageId: latestVisibleMessage?.id,
    includedMessageCount: includedMessageIds.length,
    includedHandoffCount: includedHandoffSessionIds.length,
  }, 'OpenCode external context sync projected')
}

async function projectWorkspaceDiffArtifact(
  run: RunOutput,
  event: RuntimeRunEvent,
): Promise<void> {
  const workspaceDiff = getRecord(getEventDataRecord(event).workspaceDiff)
  if (!workspaceDiff || !shouldProjectWorkspaceDiffArtifact(workspaceDiff)) {
    return
  }

  const existing = await findArtifactByRunAndSourceEvent(run.id, event.id)
  if (existing) {
    return
  }

  const messageId = await resolveWorkspaceDiffArtifactMessageId(run)
  const changedFileCount = getWorkspaceDiffChangedFileCount(workspaceDiff)
  const status = getString(workspaceDiff.status) ?? 'degraded'
  const baselineDirty = Boolean(workspaceDiff.baselineDirty)
  const summary = getString(workspaceDiff.summary) ?? formatWorkspaceDiffTitle(changedFileCount)
  const title = 'Workspace changes'
  const artifact = await createArtifact({
    conversationId: run.conversationId,
    runId: run.id,
    messageId,
    createdByAgentId: resolveWorkspaceDiffCreatedByAgentId(run),
    type: 'diff',
    title,
    status: 'ready',
    metadataJson: {
      source: 'runtime.workspaceDiff',
      runtimeEventId: event.id,
      runtimeRunId: event.runId,
      terminalEventType: event.type,
      status,
      baselineDirty,
      changedFileCount,
      summary,
    },
  })
  const version = await createArtifactVersion({
    artifactId: artifact.id as string,
    version: 1,
    source: 'agent',
    language: 'diff',
    content: formatWorkspaceDiffArtifactContent(workspaceDiff),
    summary,
    diffJson: workspaceDiff,
    createdByAgentId: resolveWorkspaceDiffCreatedByAgentId(run),
  })
  await updateArtifactCurrentVersion(artifact.id as string, version.id as string)

  runPersistenceLogger.info({
    conversationId: run.conversationId,
    runId: run.id,
    runtimeRunId: event.runId,
    eventId: event.id,
    artifactId: artifact.id,
    messageId,
    changedFileCount,
    status,
    baselineDirty,
  }, 'Workspace diff artifact projected')
}

async function resolveWorkspaceDiffArtifactMessageId(run: RunOutput): Promise<string> {
  const messages = await listMessagesByRun(run.id)
  const assistant = messages
    .filter((message) => message.surface === 'chat' && message.role === 'assistant')
    .sort(comparePersistedMessages)
    .at(-1)
  return assistant?.id ?? run.triggerMessageId
}

function shouldProjectWorkspaceDiffArtifact(workspaceDiff: Record<string, unknown>): boolean {
  const changedFileCount = getWorkspaceDiffChangedFileCount(workspaceDiff)
  return changedFileCount > 0
}

function getWorkspaceDiffChangedFileCount(workspaceDiff: Record<string, unknown>): number {
  const stats = getRecord(workspaceDiff.stats)
  const fromStats = getNumber(stats?.filesChanged)
  if (fromStats !== undefined) return fromStats
  const changedFiles = workspaceDiff.changedFiles
  return Array.isArray(changedFiles) ? changedFiles.length : 0
}

function formatWorkspaceDiffArtifactContent(workspaceDiff: Record<string, unknown>): string {
  const patch = getRecord(workspaceDiff.patch)
  const patchText = getString(patch?.text)
  if (patchText !== undefined) {
    return patchText
  }

  const summary = getString(workspaceDiff.summary) ?? 'Workspace diff summary'
  const changedFiles = Array.isArray(workspaceDiff.changedFiles)
    ? workspaceDiff.changedFiles
      .map((item) => getRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
    : []
  const lines = changedFiles
    .map((file) => {
      const path = getString(file.path)
      if (!path) return null
      const status = getString(file.statusAfter) ?? getString(file.statusBefore)
      return status ? `${status} ${path}` : path
    })
    .filter((line): line is string => Boolean(line))
  return [summary, ...lines].join('\n')
}

function formatWorkspaceDiffTitle(changedFileCount: number): string {
  if (changedFileCount === 0) return 'Workspace changes'
  return `${changedFileCount} workspace file${changedFileCount === 1 ? '' : 's'} changed`
}

function resolveWorkspaceDiffCreatedByAgentId(run: RunOutput): string | undefined {
  const input = run.inputJson as Record<string, unknown>
  const addressedAgentIds = Array.isArray(input.addressedAgentIds)
    ? input.addressedAgentIds.filter((item): item is string => typeof item === 'string')
    : []
  if (addressedAgentIds.length === 1) {
    return addressedAgentIds[0]
  }

  const participantAgentIds = Array.isArray(input.participantAgentIds)
    ? input.participantAgentIds.filter((item): item is string => typeof item === 'string')
    : []
  return participantAgentIds.length === 1 ? participantAgentIds[0] : run.orchestratorAgentId ?? undefined
}

async function updateArtifactCurrentVersion(artifactId: string, versionId: string): Promise<void> {
  await updateArtifact(artifactId, { currentVersionId: versionId })
}

async function findLatestVisibleContextMessage(conversationId: string): Promise<PersistedMessage | null> {
  const messages = await listMessagesWithParts(conversationId, {
    limit: 100,
    order: 'desc',
  })
  for (const record of messages) {
    const message = toPersistedMessage(record as Record<string, unknown>)
    if (message.surface !== 'chat') continue
    if (message.status !== 'completed') continue
    if (message.role !== 'user' && message.role !== 'assistant') continue
    const hasText = message.parts.some((part) => part.type === 'text' && part.text?.trim())
    if (hasText) return message
  }
  return null
}

function isExternalSessionScope(value: string): value is ExternalSessionScope {
  return value === 'conversation-visible' || value === 'delegated-task'
}

async function projectRuntimeMessageDeltaEvents(
  run: RunOutput,
  items: SequencedRuntimeEvent[],
): Promise<void> {
  if (!items.length) return

  const orderedItems = [...items].sort((left, right) => left.sequence - right.sequence)
  const firstItem = orderedItems[0]
  const lastItem = orderedItems[orderedItems.length - 1]
  const firstEvent = firstItem.event
  const runtimeMessageId = resolveRuntimeMessageId(firstEvent)
  const messageId = resolveLocalMessageId(run.id, runtimeMessageId)
  const surface = resolveMessageSurface(run, firstEvent)

  let message = await findMessageByRunAndRuntimeMessageId(run.id, runtimeMessageId)
  const textPart = message
    ? await findMessagePartByMessageAndKey(message.id, 'text')
    : null
  const lastProjectedSequence = textPart?.lastEventSequence ?? 0
  const unprojectedItems = orderedItems.filter((item) => item.sequence > lastProjectedSequence)
  const text = unprojectedItems
    .map((item) => getString(getEventDataRecord(item.event).delta) ?? '')
    .join('')
  if (!text) return

  if (!message) {
    message = await createMessage({
      id: messageId,
      conversationId: run.conversationId,
      runId: run.id,
      runtimeMessageId,
      runtimeRunId: firstEvent.runId,
      messageIndex: firstEvent.messageIndex ?? null,
      surface,
      role: 'assistant',
      senderType: surface === 'chat'
        ? firstEvent.agentId === run.orchestratorAgentId
          ? 'orchestrator'
          : 'agent'
        : 'agent',
      senderId: firstEvent.agentId,
      agentId: firstEvent.agentId,
      taskId: firstEvent.taskId ?? firstEvent.parentTaskId ?? null,
      groupId: firstEvent.groupId ?? null,
      status: 'streaming',
      firstEventSequence: firstItem.sequence,
      lastEventSequence: lastItem.sequence,
      metadataJson: {
        runtime: {
          messageId: runtimeMessageId,
          runtimeRunId: firstEvent.runId,
          messageIndex: firstEvent.messageIndex ?? null,
          surface,
          firstEventSequence: firstItem.sequence,
          lastEventSequence: lastItem.sequence,
        },
      },
    })
  }

  const firstSequence = textPart?.firstEventSequence ?? unprojectedItems[0].sequence
  const lastSequence = unprojectedItems[unprojectedItems.length - 1].sequence
  const lastEvent = unprojectedItems[unprojectedItems.length - 1].event
  const data = getEventDataRecord(lastEvent)

  if (!textPart) {
    const currentParts = await listMessagePartsByMessage(message.id)
    await createMessagePart({
      messageId: message.id,
      conversationId: run.conversationId,
      runId: run.id,
      runtimeEventId: lastEvent.id,
      partKey: 'text',
      partIndex: currentParts.length,
      entityType: 'runtime_message',
      entityId: message.id,
      type: 'text',
      state: 'streaming',
      text,
      payloadJson: data,
      firstEventSequence: firstSequence,
      lastEventSequence: lastSequence,
    })
  } else {
    await updateMessagePart(textPart.id, {
      state: 'streaming',
      text: `${textPart.text ?? ''}${text}`,
      payloadJson: data,
      entityType: 'runtime_message',
      entityId: message.id,
      firstEventSequence: firstSequence,
      lastEventSequence: lastSequence,
    })
  }

  await updateMessage(message.id, {
    runtimeMessageId,
    runtimeRunId: lastEvent.runId,
    messageIndex: message.messageIndex ?? lastEvent.messageIndex ?? null,
    surface,
    taskId: lastEvent.taskId ?? lastEvent.parentTaskId ?? null,
    groupId: lastEvent.groupId ?? null,
    firstEventSequence: message.firstEventSequence ?? firstSequence,
    lastEventSequence: lastSequence,
    status: 'streaming',
    metadataJson: mergeRuntimeMetadata(message.metadataJson, {
      messageId: runtimeMessageId,
      runtimeRunId: lastEvent.runId,
      messageIndex: lastEvent.messageIndex ?? null,
      surface,
      firstEventSequence: message.firstEventSequence ?? firstSequence,
      lastEventSequence: lastSequence,
    }),
  })
}

async function projectSystemAgentCompletedEvent(
  run: RunOutput,
  event: RuntimeRunEvent,
  hubEventBus: HubEventBus,
): Promise<void> {
  const data = getEventDataRecord(event)
  if (
    getString(data.systemAgentId) !== 'title' ||
    getString(data.target) !== 'conversation.title'
  ) {
    return
  }

  const eventConversationId = getString(data.conversationId)
  if (eventConversationId && eventConversationId !== run.conversationId) {
    return
  }

  const result = getRecord(data.result)
  const title = normalizeConversationTitle(getString(result?.title))
  if (!title) {
    return
  }

  const conversation = await findConversationWithAgents(run.conversationId)
  if (!conversation) {
    return
  }
  if (getTitleSource(conversation.metadataJson) === 'manual') {
    return
  }

  await updateConversation(run.conversationId, {
    title,
    metadataJson: {
      ...conversation.metadataJson,
      titleSource: 'auto',
      autoTitle: {
        runId: run.id,
        runtimeRunId: event.runId,
        eventId: event.id,
        updatedAt: event.timestamp,
      },
    },
  })
  hubEventBus.publish('conversation.title.updated', {
    conversationId: run.conversationId,
    runId: run.id,
    runtimeRunId: event.runId,
    title,
  })
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
  if (block && (block.lastEventSequence ?? 0) >= sequence) {
    return
  }
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

async function projectReasoningDeltaEvents(
  run: RunOutput,
  items: SequencedRuntimeEvent[],
): Promise<void> {
  if (!items.length) return

  const orderedItems = [...items].sort((left, right) => left.sequence - right.sequence)
  const firstItem = orderedItems[0]
  const lastItem = orderedItems[orderedItems.length - 1]
  const firstEvent = firstItem.event
  const lastEvent = lastItem.event
  const firstData = getEventDataRecord(firstEvent)
  const lastData = getEventDataRecord(lastEvent)
  const reasoningId = getString(firstData.reasoningId) ?? 'default'

  let block = await findRunReasoningBlockByRunAndReasoning(run.id, reasoningId)
  const blockLastSequence = block?.lastEventSequence ?? 0
  const unprojectedBlockItems = orderedItems.filter((item) => item.sequence > blockLastSequence)
  const blockText = unprojectedBlockItems
    .map((item) => getString(getEventDataRecord(item.event).delta) ?? '')
    .join('')

  if (blockText) {
    const firstSequence = block?.firstEventSequence ?? unprojectedBlockItems[0].sequence
    const lastSequence = unprojectedBlockItems[unprojectedBlockItems.length - 1].sequence
    if (!block) {
      block = await createRunReasoningBlock({
        runId: run.id,
        conversationId: run.conversationId,
        reasoningId,
        agentId: lastEvent.agentId ?? null,
        parentAgentId: lastEvent.parentAgentId ?? null,
        parentTaskId: lastEvent.parentTaskId ?? null,
        taskId: lastEvent.taskId ?? null,
        groupId: lastEvent.groupId ?? null,
        messageId: lastEvent.messageId ?? null,
        messageIndex: lastEvent.messageIndex ?? null,
        content: blockText,
        state: 'streaming',
        payloadJson: lastData,
        firstEventSequence: firstSequence,
        lastEventSequence: lastSequence,
        startedAt: null,
        completedAt: null,
      })
    } else {
      block = await updateRunReasoningBlock(block.id, {
        agentId: lastEvent.agentId ?? block.agentId,
        parentAgentId: lastEvent.parentAgentId ?? block.parentAgentId,
        parentTaskId: lastEvent.parentTaskId ?? block.parentTaskId,
        taskId: lastEvent.taskId ?? block.taskId,
        groupId: lastEvent.groupId ?? block.groupId,
        messageId: lastEvent.messageId ?? block.messageId,
        messageIndex: lastEvent.messageIndex ?? block.messageIndex,
        content: `${block.content ?? ''}${blockText}`,
        state: 'streaming',
        payloadJson: lastData,
        firstEventSequence: firstSequence,
        lastEventSequence: lastSequence,
      })
    }
  }

  if (!lastEvent.messageId) {
    return
  }

  const message = await findMessageByRunAndRuntimeMessageId(run.id, resolveRuntimeMessageId(lastEvent))
  if (!message) return

  const existingPart = await findMessagePartByMessageAndKey(message.id, `reasoning:${reasoningId}`)
  const partLastSequence = existingPart?.lastEventSequence ?? 0
  const unprojectedPartItems = orderedItems.filter((item) => item.sequence > partLastSequence)
  const partText = unprojectedPartItems
    .map((item) => getString(getEventDataRecord(item.event).delta) ?? '')
    .join('')
  if (!partText) return

  await upsertMessagePartForRuntimeEvent(
    run,
    message,
    lastEvent,
    unprojectedPartItems[unprojectedPartItems.length - 1].sequence,
    'reasoning',
    `reasoning:${reasoningId}`,
    'reasoning_block',
    reasoningId,
    'streaming',
    partText,
    false,
    existingPart?.firstEventSequence ?? unprojectedPartItems[0].sequence,
  )
}

async function projectPermissionEvent(
  run: RunOutput,
  event: RuntimeRunEvent,
  sequence: number,
): Promise<void> {
  const data = getEventDataRecord(event)
  const requestData = getRecord(data.data)
  const requestId = getString(data.requestId) ?? event.toolCallId ?? event.id
  const status = mapPermissionStatus(event.type)
  const reason = getString(data.reason) ?? getString(data.message) ?? getString(data.summary) ?? null
  const permissionType = normalizePermissionType(
    getString(data.permissionType) ?? getString(requestData?.permissionType)
  )
  const target = getString(data.target) ??
    getString(requestData?.url) ??
    getString(requestData?.logicalPath) ??
    getString(requestData?.host) ??
    event.toolName ??
    'tool'

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
      permissionType,
      target,
      description: reason ?? 'Runtime permission request',
      status,
      reason,
      decisionReason: getString(data.decisionReason) ?? null,
      grantJson: getRecord(data.grant) ?? null,
      dataJson: requestData ?? null,
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
  firstSequence = sequence,
): Promise<void> {
  const data = getEventDataRecord(event)
  const existing = await findMessagePartByMessageAndKey(message.id, partKey)
  if (existing && (existing.lastEventSequence ?? 0) >= sequence) {
    return
  }
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
      firstEventSequence: firstSequence,
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
    firstEventSequence: existing.firstEventSequence ?? firstSequence,
    lastEventSequence: sequence,
  })
}

function resolveRuntimeMessageId(event: RuntimeRunEvent): string {
  return event.messageId ??
    `msg_${event.runId}_${event.agentId ?? 'assistant'}_${event.taskId ?? 'entry'}`
}

function getMessageProjectionKey(event: RuntimeRunEvent): string {
  return resolveRuntimeMessageId(event)
}

function getReasoningProjectionKey(event: RuntimeRunEvent): string {
  const data = getEventDataRecord(event)
  const reasoningId = getString(data.reasoningId) ?? 'default'
  return `${event.messageId ?? 'no-message'}:${event.agentId ?? 'unknown'}:${reasoningId}`
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

function isRunForOpenCode(run: RunOutput): boolean {
  return getParticipantAgentIds(run).has('opencode') || run.orchestratorAgentId === 'opencode'
}

function isOpenCodeEvent(event: RuntimeRunEvent): boolean {
  if (event.agentId === 'opencode') return true
  const data = getEventDataRecord(event)
  if (getString(data.externalProvider) === 'opencode') return true
  const externalSession = getRecord(data.externalSession)
  return getString(externalSession?.provider) === 'opencode'
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

function getExternalModelFromEvent(event: RuntimeRunEvent): Record<string, unknown> | undefined {
  const data = getEventDataRecord(event)
  const externalModel = getRecord(data.externalModel)
  if (!externalModel) return undefined

  const provider = getString(externalModel.provider)
  const providerId = getString(externalModel.providerId)
  const modelId = getString(externalModel.modelId)
  const providerName = getString(externalModel.providerName)
  const modelName = getString(externalModel.modelName)
  if (!provider || !providerId || !modelId) {
    return undefined
  }

  return {
    provider,
    providerId,
    modelId,
    ...(providerName ? { providerName } : {}),
    ...(modelName ? { modelName } : {}),
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

function normalizePermissionType(value: string | undefined): PermissionType {
  switch (value) {
    case 'file_read':
    case 'file_write':
    case 'command_execute':
    case 'network_access':
    case 'deployment':
      return value
    default:
      return 'command_execute'
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
  addressedAgentIds: string[],
  externalSessionHints: RuntimeExternalSessionHint[] = [],
  externalContext: RuntimeExternalContextPacket[] = [],
  userMessageId?: string,
): RuntimeRunInput {
  const workspace = getRuntimeWorkspace(conversation.metadataJson)
  const titleSource = getTitleSource(conversation.metadataJson)
  const titleSeedUserMessage = resolveTitleSeedUserMessage(history, userContent)

  return {
    conversationId: conversation.id,
    mode: conversation.mode as 'single' | 'group',
    participantAgentIds: conversation.agents.map((agent) => agent.agentId),
    addressedAgentIds,
    userMessage: {
      ...(userMessageId ? { id: userMessageId } : {}),
      role: 'user',
      content: userContent,
    },
    history,
    conversationState: {
      messageCountBeforeRun: history.length,
      titleSource,
      ...(titleSource === 'default' && titleSeedUserMessage
        ? { titleSeedUserMessage }
        : {}),
    },
    diagnostics: loadSettings().diagnostics,
    ...(workspace ? { workspace } : {}),
    ...(externalSessionHints.length > 0 ? { externalSessionHints } : {}),
    ...(externalContext.length > 0 ? { externalContext } : {}),
  }
}

async function resolveDirectOpenCodeSession(
  conversation: ConversationDetailOutput,
  addressedAgentIds: string[],
): Promise<ExternalAgentSessionOutput | null> {
  const workspace = getRuntimeWorkspace(conversation.metadataJson)
  if (!workspace) return null

  const directAgentId = resolveDirectExternalAgentId(conversation, addressedAgentIds)
  if (directAgentId !== 'opencode') return null

  return findExternalAgentSessionHint({
    provider: 'opencode',
    agentId: directAgentId,
    conversationId: conversation.id,
    workspaceIdentity: workspace.workspaceId,
    scope: 'conversation-visible',
    status: 'active',
  })
}

function toRuntimeExternalSessionHint(session: ExternalAgentSessionOutput): RuntimeExternalSessionHint {
  return {
    provider: 'opencode',
    agentId: session.agentId,
    scope: session.scope,
    providerSessionId: session.providerSessionId,
    conversationId: session.conversationId,
    workspaceId: session.workspaceIdentity,
    ...(session.handoffSummary ? { handoffSummary: session.handoffSummary } : {}),
  }
}

async function resolveExternalContextPackets(
  conversation: ConversationDetailOutput,
  addressedAgentIds: string[],
  historyMessages: unknown[],
  directOpenCodeSession: ExternalAgentSessionOutput | null,
): Promise<RuntimeExternalContextPacket[]> {
  const workspace = getRuntimeWorkspace(conversation.metadataJson)
  if (!workspace) return []

  const directAgentId = resolveDirectExternalAgentId(conversation, addressedAgentIds)
  if (directAgentId !== 'opencode') return []

  const delegatedSessions = await listExternalAgentSessions({
    conversationId: conversation.id,
    provider: 'opencode',
    agentId: directAgentId,
    scope: 'delegated-task',
    status: 'active',
    limit: 20,
    order: 'desc',
  })
  const packet = buildOpenCodeExternalContextPacket({
    agentId: directAgentId,
    sessionMetadata: directOpenCodeSession?.metadataJson ?? {},
    historyMessages,
    delegatedSessions,
  })
  return packet ? [packet] : []
}

export function buildOpenCodeExternalContextPacket(options: {
  agentId: string
  sessionMetadata?: MetadataJson
  historyMessages: unknown[]
  delegatedSessions?: ExternalAgentSessionOutput[]
}): RuntimeExternalContextPacket | null {
  const bridge = getContextBridgeMetadata(options.sessionMetadata)
  const messages = projectMessagesToExternalContextMessages(options.historyMessages)
  const cursorIndex = bridge.lastSyncedMessageId
    ? messages.findIndex((message) => message.id === bridge.lastSyncedMessageId)
    : -1
  const mode: RuntimeExternalContextPacket['mode'] =
    bridge.lastSyncedMessageId && cursorIndex >= 0 ? 'delta' : 'bootstrap'
  const candidateMessages = mode === 'delta'
    ? messages.slice(cursorIndex + 1)
    : messages
  const boundedMessages = takeBoundedExternalContextMessages(candidateMessages)
  const handoffs = selectExternalContextHandoffs(
    options.delegatedSessions ?? [],
    mode,
    bridge.lastSyncedAt,
  )

  if (boundedMessages.messages.length === 0 && handoffs.summaries.length === 0) {
    return null
  }

  const throughMessage = boundedMessages.messages.at(-1)
  const omitted = compactOmitted({
    messageCount: boundedMessages.omittedMessageCount,
    characterCount: boundedMessages.omittedCharacterCount,
    handoffSummaryCount: handoffs.omittedHandoffSummaryCount,
  })

  return {
    provider: 'opencode',
    agentId: options.agentId,
    scope: 'conversation-visible',
    mode,
    messages: boundedMessages.messages,
    handoffSummaries: handoffs.summaries,
    cursorCandidate: {
      ...(throughMessage ? {
        throughMessageId: throughMessage.id,
        throughMessageCreatedAt: throughMessage.createdAt,
      } : {}),
      includedMessageIds: boundedMessages.messages.map((message) => message.id),
      includedHandoffSessionIds: handoffs.summaries
        .map((summary) => summary.sessionId)
        .filter((id): id is string => Boolean(id)),
    },
    ...(omitted ? { omitted } : {}),
  }
}

function getContextBridgeMetadata(metadata: MetadataJson | undefined): {
  lastSyncedMessageId?: string
  lastSyncedAt?: string
} {
  const bridge = getRecord(metadata?.contextBridge)
  const lastSyncedMessageId = getString(bridge?.lastSyncedMessageId)
  const lastSyncedAt = getString(bridge?.lastSyncedAt)
  return {
    ...(lastSyncedMessageId ? { lastSyncedMessageId } : {}),
    ...(lastSyncedAt ? { lastSyncedAt } : {}),
  }
}

function projectMessagesToExternalContextMessages(records: unknown[]): RuntimeExternalContextMessage[] {
  return records.flatMap((record) => {
    const message = toPersistedMessage(record as Record<string, unknown>)
    if (message.surface !== 'chat') return []
    if (message.status !== 'completed') return []
    if (message.role !== 'user' && message.role !== 'assistant') return []
    const content = message.parts
      .filter((part) => part.type === 'text' && part.text)
      .map((part) => part.text)
      .join('\n')
      .trim()
    if (!content) return []

    const senderLabel = resolveExternalContextSenderLabel(message)
    return [{
      id: message.id,
      role: message.role as RuntimeExternalContextMessage['role'],
      ...(message.agentId ? { agentId: message.agentId } : {}),
      ...(senderLabel ? { senderLabel } : {}),
      createdAt: message.createdAt,
      content: truncateText(content, OPENCODE_EXTERNAL_CONTEXT_MAX_MESSAGE_CHARS),
    }]
  })
}

function resolveExternalContextSenderLabel(message: PersistedMessage): string | undefined {
  if (message.role === 'user') return 'user'
  if (message.agentId) return message.agentId
  if (message.senderType) return message.senderType
  return undefined
}

function takeBoundedExternalContextMessages(messages: RuntimeExternalContextMessage[]): {
  messages: RuntimeExternalContextMessage[]
  omittedMessageCount: number
  omittedCharacterCount: number
} {
  const selected: RuntimeExternalContextMessage[] = []
  let usedCharacters = 0
  let omittedMessageCount = 0
  let omittedCharacterCount = 0

  for (const message of [...messages].reverse()) {
    const characterCount = message.content.length
    const wouldExceedCount = selected.length >= OPENCODE_EXTERNAL_CONTEXT_MAX_MESSAGES
    const wouldExceedChars = usedCharacters + characterCount > OPENCODE_EXTERNAL_CONTEXT_MAX_CHARS
    if (wouldExceedCount || wouldExceedChars) {
      omittedMessageCount += 1
      omittedCharacterCount += characterCount
      continue
    }
    selected.push(message)
    usedCharacters += characterCount
  }

  return {
    messages: selected.reverse(),
    omittedMessageCount,
    omittedCharacterCount,
  }
}

function selectExternalContextHandoffs(
  sessions: ExternalAgentSessionOutput[],
  mode: RuntimeExternalContextPacket['mode'],
  lastSyncedAt?: string,
): {
  summaries: RuntimeExternalContextHandoffSummary[]
  omittedHandoffSummaryCount: number
} {
  const candidates = sessions
    .filter((session) => {
      if (!session.handoffSummary?.trim()) return false
      if (mode !== 'delta' || !lastSyncedAt) return true
      return session.updatedAt > lastSyncedAt
    })

  const selected = candidates.slice(0, OPENCODE_EXTERNAL_CONTEXT_MAX_HANDOFFS)
  return {
    summaries: selected.reverse().map((session) => ({
      sessionId: session.id,
      providerSessionId: session.providerSessionId,
      ...(session.taskId ? { taskId: session.taskId } : {}),
      ...(session.runId ? { runId: session.runId } : {}),
      summary: session.handoffSummary!.trim(),
    })),
    omittedHandoffSummaryCount: Math.max(0, candidates.length - selected.length),
  }
}

function compactOmitted(omitted: {
  messageCount: number
  characterCount: number
  handoffSummaryCount: number
}): RuntimeExternalContextPacket['omitted'] | undefined {
  const result = {
    ...(omitted.messageCount > 0 ? { messageCount: omitted.messageCount } : {}),
    ...(omitted.characterCount > 0 ? { characterCount: omitted.characterCount } : {}),
    ...(omitted.handoffSummaryCount > 0 ? { handoffSummaryCount: omitted.handoffSummaryCount } : {}),
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

function resolveDirectExternalAgentId(
  conversation: ConversationDetailOutput,
  addressedAgentIds: string[],
): string | null {
  if (conversation.mode === 'single') {
    return conversation.agents.length === 1 ? conversation.agents[0]?.agentId ?? null : null
  }

  return addressedAgentIds.length === 1 ? addressedAgentIds[0] ?? null : null
}

export function resolveAddressedAgentIds(
  conversation: {
    mode: string
    agents: Array<{ agentId: string }>
  },
  addressedAgentIds: string[] | undefined,
): string[] {
  const normalized = (addressedAgentIds ?? []).map((agentId) => agentId.trim())
  if (normalized.some((agentId) => !agentId)) {
    throw invalidEntryAgent('Addressed agent id cannot be empty')
  }

  if (new Set(normalized).size !== normalized.length) {
    throw invalidEntryAgent('Addressed agents must be unique')
  }

  if (normalized.length > 1) {
    throw invalidEntryAgent('Only one addressed agent is supported in this version')
  }

  if (normalized.length === 0) {
    return []
  }

  const agentId = normalized[0]
  if (!agentId) {
    return []
  }
  const participantIds = new Set(
    conversation.agents.map((agent) => agent.agentId)
  )
  if (!participantIds.has(agentId)) {
    throw invalidEntryAgent('Addressed agent must be a conversation member')
  }

  if (conversation.mode === 'single') {
    const [singleAgent] = conversation.agents
    if (conversation.agents.length !== 1 || singleAgent?.agentId !== agentId) {
      throw invalidEntryAgent('Single chat can only address its only member')
    }
  }

  return [agentId]
}

function invalidEntryAgent(message: string): AppError {
  return new AppError(
    400 as ContentfulStatusCode,
    'RUN_INVALID_ENTRY_AGENT',
    message,
  )
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

function resolveTitleSeedUserMessage(
  history: RuntimeMessage[],
  currentUserContent: string,
): string | undefined {
  const firstHistoryUserMessage = history.find((message) =>
    message.role === 'user' && message.content.trim().length > 0
  )?.content.trim()
  if (firstHistoryUserMessage) {
    return firstHistoryUserMessage
  }

  const current = currentUserContent.trim()
  return current || undefined
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

async function attachArtifactsToMessages(messages: PersistedMessage[]): Promise<PersistedMessage[]> {
  const messageIds = messages.map((message) => message.id)
  const artifacts = await listArtifactsByMessageIds(messageIds)
  if (artifacts.length === 0) return messages

  const artifactsByMessageId = new Map<string, PersistedArtifact[]>()
  for (const artifact of artifacts) {
    const messageId = typeof artifact.messageId === 'string' ? artifact.messageId : null
    if (!messageId) continue
    const current = artifactsByMessageId.get(messageId) ?? []
    current.push(artifact as PersistedArtifact)
    artifactsByMessageId.set(messageId, current)
  }

  return messages.map((message) => ({
    ...message,
    artifacts: artifactsByMessageId.get(message.id) ?? [],
  }))
}

function toHubEnvelope(event: RunEventOutput): HubRunEventEnvelope[] {
  const runtimeEvent = (event.payloadJson as { event?: RuntimeRunEvent }).event
  if (!runtimeEvent) return []
  return [{
    sequence: event.sequence,
    event: {
      ...runtimeEvent,
      runId: event.runId,
      runtimeRunId: event.runtimeRunId ?? runtimeEvent.runId,
    },
  }]
}

function toProductHubEnvelope(event: RunEventOutput): HubRunEventEnvelope[] {
  return toHubEnvelope(event).map(toProductHubRunEventEnvelope)
}

export function toProductHubRunEventEnvelope(
  envelope: HubRunEventEnvelope,
): HubRunEventEnvelope {
  return {
    ...envelope,
    event: toProductRuntimeEvent(envelope.event),
  }
}

function toProductRuntimeEvent(event: RuntimeRunEvent): RuntimeRunEvent {
  if (event.type !== 'tool.completed' && event.type !== 'tool.failed') {
    return event
  }

  const data = getRecord(event.data)
  if (!data) return event

  const outputKey = getRecord(data.data) ? 'data' : getRecord(data.result) ? 'result' : null
  if (!outputKey) return event

  const output = getRecord(data[outputKey])
  if (!output) return event

  if (event.toolName === 'web_fetch') {
    return {
      ...event,
      data: {
        ...data,
        [outputKey]: toWebFetchUiSummary(output),
      },
    }
  }

  if (event.toolName === 'bash') {
    return {
      ...event,
      data: {
        ...data,
        [outputKey]: toBashUiSummary(output),
      },
    }
  }

  return event
}

function toWebFetchUiSummary(output: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(output)) {
    if (key !== 'body' && key !== 'headers') {
      summary[key] = value
    }
  }

  const body = output.body
  const headers = getRecord(output.headers)
  return {
    ...summary,
    ...(headers ? { headerCount: Object.keys(headers).length } : {}),
    ...(typeof body === 'string' ? { bodyCharacters: body.length } : {}),
    bodyOmittedForUi: true,
  }
}

function toBashUiSummary(output: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(output)) {
    if (key !== 'stdout' && key !== 'stderr') {
      summary[key] = value
    }
  }

  const stdout = typeof output.stdout === 'string' ? output.stdout : ''
  const stderr = typeof output.stderr === 'string' ? output.stderr : ''
  const stdoutTruncatedForUi = stdout.length > BASH_OUTPUT_UI_PREVIEW_CHARS
  const stderrTruncatedForUi = stderr.length > BASH_OUTPUT_UI_PREVIEW_CHARS

  return {
    ...summary,
    stdout: stdoutTruncatedForUi ? stdout.slice(0, BASH_OUTPUT_UI_PREVIEW_CHARS) : stdout,
    stderr: stderrTruncatedForUi ? stderr.slice(0, BASH_OUTPUT_UI_PREVIEW_CHARS) : stderr,
    stdoutCharacters: stdout.length,
    stderrCharacters: stderr.length,
    stdoutTruncatedForUi,
    stderrTruncatedForUi,
  }
}

function toSequencedRuntimeEvent(event: RunEventOutput): SequencedRuntimeEvent[] {
  const runtimeEvent = (event.payloadJson as { event?: RuntimeRunEvent }).event
  if (!runtimeEvent) return []
  return [{ sequence: event.sequence, event: runtimeEvent }]
}

export function isPersistedTerminalRuntimeEvent(
  record: { type?: string | null; payloadJson?: unknown },
): boolean {
  if (isTerminalRuntimeEventType(getString(record.type))) {
    return true
  }

  const payload = getRecord(record.payloadJson)
  const event = getRecord(payload?.event)
  return isTerminalRuntimeEventType(getString(event?.type))
}

function isTerminalRuntimeEventType(type: string | undefined): boolean {
  return type === 'run.completed' ||
    type === 'run.failed' ||
    type === 'run.cancelled'
}

export function isRetryableRuntimeEventStreamError(error: unknown): boolean {
  if (error instanceof AppError && error.code === 'RUNTIME_NOT_READY') {
    return true
  }

  const record = getRecord(error)
  const code = getString(record?.code)
  const name = error instanceof Error
    ? error.name
    : getString(record?.name)
  const message = error instanceof Error
    ? error.message
    : getString(record?.message) ?? ''

  return code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code === 'ETIMEDOUT' ||
    name === 'AbortError' ||
    message.includes('socket connection was closed unexpectedly') ||
    message.includes('fetch failed') ||
    message.includes('terminated')
}

function delayRuntimeEventStreamRetry(retryCount: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, RUNTIME_EVENT_STREAM_RETRY_DELAY_MS * retryCount)
  })
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

function normalizeConversationTitle(value: string | undefined): string | null {
  const title = value
    ?.trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[。.!！?？]+$/g, '')
    .trim()

  if (!title) {
    return null
  }

  return title.length > 80 ? title.slice(0, 80).trim() : title
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

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function truncatePreview(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return Array.from(normalized).slice(0, 50).join('')
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

function getRuntimeErrorCode(data: unknown): string | undefined {
  const record = normalizeRuntimeError(data)
  const nested = record.error
  if (typeof nested === 'object' && nested !== null) {
    const code = (nested as Record<string, unknown>).code
    if (typeof code === 'string') return code
  }
  if (typeof record.code === 'string') return record.code
  return undefined
}

function getTerminalRunStatusFromRuntimeResponse(
  data: unknown,
): 'completed' | 'failed' | 'cancelled' | undefined {
  const status = getString(getRecord(data)?.status)
  return status === 'completed' || status === 'failed' || status === 'cancelled'
    ? status
    : undefined
}

function isAbandonableRuntimeCancelFailure(
  status: number,
  code: string | undefined,
): boolean {
  return status === 404 ||
    status === 503 ||
    code === 'RUN_NOT_FOUND' ||
    code === 'RUNTIME_NOT_READY'
}

function isAbandonableRuntimeCancelError(error: unknown): boolean {
  return error instanceof AppError && error.code === 'RUNTIME_NOT_READY'
}
