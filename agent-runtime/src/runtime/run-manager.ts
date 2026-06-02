import type { AgentDefinition, AgentRegistry } from "../agents"
import type { ModelMessage } from "ai"
import type { ProviderService } from "../provider"
import { createChildLogger } from "../logger"
import { EntryResolver, RunInputValidationError } from "./entry-resolver"
import { AiSdkExecutor } from "./ai-sdk-executor"
import { ExternalAdapterError, ExternalAdapterExecutor } from "./external-adapters"
import { AgentModelResolutionError } from "./model-resolver"
import { MockExecutor } from "./mock-executor"
import { OrchestratorExecutor } from "./orchestrator-executor"
import { buildRuntimeEnvironmentSnapshot, type RuntimeEnvironmentSnapshot } from "./environment-snapshot"
import {
  normalizeQuestionAnswers,
  normalizeQuestionToolInput,
  QuestionToolInputSchema,
  RuntimeQuestionError,
  type NormalizedQuestionAnswer,
  type NormalizedQuestionItem,
  type PendingQuestionToolCall,
  type QuestionAnswer,
} from "./question"
import { createRunEvent, isTerminalRunEvent, isTerminalStatus } from "./run-events"
import {
  SystemAgentRunner,
  createFallbackTitleSystemAgentResult,
  type SystemAgentCompletedData,
} from "./system-agents"
import { RuntimeToolRegistry, createDefaultRuntimeToolRegistry } from "./tools"
import { RuntimePermissionError, RuntimePermissionService } from "./permissions"
import { WorkspaceError, WorkspaceService } from "./workspace"
import {
  WorkspaceDiffService,
  type WorkspaceDiffBaseline,
} from "./workspace-diff"
import type {
  AgentExecutionContext,
  AgentExecutor,
  OrchestratorTask,
  RunEvent,
  RunInput,
  RunRecord,
  RunRecordResponse,
  RunStatus,
  TaskExecutionResult,
  WorkspaceDiffSummary,
} from "./types"

const log = createChildLogger("run-manager")

type RunSubscription = (event: RunEvent) => void

type RunContinuationFrame = {
  frameId: string
  kind: "approval" | "question"
  runId: string
  executionId: string
  agentId: string
  taskId?: string
  parentAgentId?: string
  groupId?: string
  parentTaskId?: string
  requestIds: string[]
  resumeMessages: ModelMessage[]
  status: "waiting" | "resuming" | "completed" | "cancelled"
  waitForResume: Promise<ModelMessage[] | null>
  resolveResume: (messages: ModelMessage[] | null) => void
}

type QuestionRequestRecord = {
  requestId: string
  runId: string
  frameId: string
  executionId: string
  agentId: string
  toolCallId: string
  toolName: "question"
  messageId?: string
  taskId?: string
  parentAgentId?: string
  groupId?: string
  parentTaskId?: string
  questions: NormalizedQuestionItem[]
  status: "pending" | "answered" | "cancelled"
  answers?: NormalizedQuestionAnswer[]
  createdAt: string
  answeredAt?: string
  cancelledAt?: string
}

type RunExecutionState = {
  abortController: AbortController
  entryAgent: AgentDefinition
  workspaceService?: WorkspaceService
  environmentSnapshot?: RuntimeEnvironmentSnapshot
  environmentSnapshotPromise: Promise<RuntimeEnvironmentSnapshot>
  workspaceDiffBaselinePromise: Promise<WorkspaceDiffBaseline>
  workspaceDiffBaseline?: WorkspaceDiffBaseline
  permissionService: RuntimePermissionService
  continuations: Map<string, RunContinuationFrame>
  questionRequests: Map<string, QuestionRequestRecord>
  activeTaskExecutions: Set<string>
  messageBlockCounters: Map<string, number>
  messageIndexById: Map<string, number>
  nextMessageIndex: number
}

type PendingSystemAgentResult<T> = {
  settled: boolean
  emitted: boolean
  result: T | null
  wait: Promise<void>
  cancel: () => void
}

const TITLE_SYSTEM_AGENT_FLUSH_GRACE_MS = 1500

export class RunWorkspaceValidationError extends Error {
  code = "RUN_INVALID_WORKSPACE" as const

  constructor(message: string, public details?: unknown) {
    super(message)
    this.name = "RunWorkspaceValidationError"
  }
}

class TaskExecutionError extends Error {
  constructor(
    public code:
      | "TASK_SOURCE_CANNOT_DELEGATE"
      | "TASK_TARGET_NOT_FOUND"
      | "TASK_TARGET_DISABLED"
      | "TASK_TARGET_NOT_ALLOWED"
      | "TASK_DEPENDENCY_FAILED"
      | "TASK_DEPENDENCY_CYCLE"
      | "TASK_EXECUTION_ABORTED"
      | "TASK_EXECUTION_FAILED",
    message: string,
    public details?: unknown
  ) {
    super(message)
    this.name = "TaskExecutionError"
  }
}

type TaskDispatchOptions = {
  groupId?: string
  parentTaskId?: string
}

export class RunManager {
  private entryResolver: EntryResolver
  private aiSdkExecutor: AiSdkExecutor
  private externalAdapterExecutor: ExternalAdapterExecutor
  private mockExecutor = new MockExecutor()
  private orchestratorExecutor: OrchestratorExecutor
  private systemAgentRunner: SystemAgentRunner
  private workspaceDiffService = new WorkspaceDiffService()
  private toolRegistry: RuntimeToolRegistry
  private runs: Map<string, RunRecord> = new Map()
  private events: Map<string, RunEvent[]> = new Map()
  private subscriptions: Map<string, Set<RunSubscription>> = new Map()
  private executionState: Map<string, RunExecutionState> = new Map()

  constructor(
    private agentRegistry: AgentRegistry,
    providerService: ProviderService,
    _legacyWorkspaceService?: WorkspaceService,
    toolRegistry: RuntimeToolRegistry = createDefaultRuntimeToolRegistry(),
    _legacyPermissionService?: RuntimePermissionService
  ) {
    this.entryResolver = new EntryResolver(agentRegistry)
    this.toolRegistry = toolRegistry
    this.aiSdkExecutor = new AiSdkExecutor(providerService, this.toolRegistry)
    this.externalAdapterExecutor = new ExternalAdapterExecutor()
    this.orchestratorExecutor = new OrchestratorExecutor(agentRegistry, providerService, this.toolRegistry)
    this.systemAgentRunner = new SystemAgentRunner(providerService)
  }

  createRun(input: RunInput): RunRecord {
    log.info(
      {
        conversationId: input.conversationId,
        mode: input.mode,
        participantAgentIds: input.participantAgentIds,
        addressedAgentIds: input.addressedAgentIds ?? [],
      },
      "Resolving entry agent for run"
    )

    const resolution = this.entryResolver.resolve(input)
    log.info(
      {
        entryAgentIds: resolution.entryAgentIds,
        entryReason: resolution.entryReason,
      },
      "Entry agent resolved"
    )

    const now = new Date().toISOString()
    const run: RunRecord = {
      id: `run_${crypto.randomUUID()}`,
      status: "queued",
      input,
      entryAgentIds: resolution.entryAgentIds,
      entryReason: resolution.entryReason,
      createdAt: now,
      updatedAt: now,
    }

    const abortController = new AbortController()
    const workspaceService = this.createWorkspaceSession(run.id, input)
    const environmentSnapshotPromise = buildRuntimeEnvironmentSnapshot({ workspaceService })
    const workspaceDiffBaselinePromise = this.workspaceDiffService.captureBaseline(workspaceService)
    const permissionService = new RuntimePermissionService(workspaceService)

    this.runs.set(run.id, run)
    this.events.set(run.id, [])
    this.executionState.set(run.id, {
      abortController,
      entryAgent: resolution.entryAgents[0],
      workspaceService,
      environmentSnapshotPromise,
      workspaceDiffBaselinePromise,
      permissionService,
      continuations: new Map(),
      questionRequests: new Map(),
      activeTaskExecutions: new Set(),
      messageBlockCounters: new Map(),
      messageIndexById: new Map(),
      nextMessageIndex: 0,
    })

    log.info({ runId: run.id, entryAgentId: resolution.entryAgents[0].id }, "Run created, scheduling execution")
    queueMicrotask(() => {
      void this.executeRun(run.id, resolution.entryAgents[0], abortController)
    })

    return run
  }

  getRun(runId: string): RunRecord | null {
    return this.runs.get(runId) ?? null
  }

  getRunResponse(runId: string): RunRecordResponse | null {
    const run = this.runs.get(runId)
    if (!run) {
      return null
    }
    const workspaceService = this.executionState.get(runId)?.workspaceService
    const { workspace: _privateWorkspace, ...publicInput } = run.input
    const handle = workspaceService?.getHandle()
    return {
      ...run,
      input: {
        ...publicInput,
        ...(handle ? {
          workspace: {
            workspaceId: handle.workspaceId,
            backendType: "local",
            rootLabel: handle.rootLabel,
          },
        } : {}),
      },
    }
  }

  getEvents(runId: string): RunEvent[] | null {
    const events = this.events.get(runId)
    return events ? [...events] : null
  }

  listPermissions(runId: string) {
    return this.executionState.get(runId)?.permissionService.listRequests(runId) ?? []
  }

  decidePermission(runId: string, requestId: string, approved: boolean, reason?: string) {
    const run = this.runs.get(runId)
    const state = this.executionState.get(runId)
    if (!run) {
      throw new RuntimePermissionError("PERMISSION_NOT_FOUND", `Run ${runId} not found`, 404)
    }
    if (!state || isTerminalStatus(run.status)) {
      throw new RuntimePermissionError(
        "PERMISSION_RUN_NOT_ACTIVE",
        `Run ${runId} is not waiting for approval`,
        409
      )
    }

    const currentRequest = state.permissionService.getRequest(requestId)
    if (!currentRequest || currentRequest.runId !== runId) {
      throw new RuntimePermissionError("PERMISSION_NOT_FOUND", `Permission request ${requestId} not found`, 404)
    }
    const frame = Array.from(state.continuations.values()).find((candidate) =>
      candidate.kind === "approval" &&
      candidate.status === "waiting" &&
      candidate.requestIds.includes(requestId)
    )
    if (!currentRequest.approvalId || !frame) {
      throw new RuntimePermissionError(
        "PERMISSION_RUN_NOT_ACTIVE",
        `Run ${runId} has no resumable approval continuation`,
        409
      )
    }
    const request = state.permissionService.decide(requestId, { approved, reason }, (event) => this.emit(event))

    if (!approved) {
      const failed = createRunEvent(runId, "tool.failed", request.agentId, {
        status: "failed",
        summary: reason ?? `Tool ${request.toolName} execution was denied`,
        error: {
          code: "TOOL_EXECUTION_DENIED",
          message: reason ?? `Tool ${request.toolName} execution was denied`,
        },
      })
      failed.toolCallId = request.toolCallId
      failed.toolName = request.toolName
      failed.messageId = request.messageId
      failed.parentAgentId = request.parentAgentId ?? request.agentId
      failed.taskId = request.taskId
      failed.parentTaskId = request.parentTaskId
      failed.groupId = request.groupId
      this.emit(failed)
    }

    const requests = frame.requestIds.map((id) => state.permissionService.getRequest(id))
    if (requests.every((candidate) => candidate && candidate.status !== "pending")) {
      const responseParts = requests.map((candidate) => ({
        type: "tool-approval-response" as const,
        approvalId: candidate!.approvalId!,
        approved: candidate!.status === "approved",
        reason: candidate!.decisionReason,
      }))
      frame.status = "resuming"
      if (frame.taskId) {
        state.activeTaskExecutions.add(frame.executionId)
      }
      this.updateRunStatus(run, "running")
      frame.resolveResume([
        ...frame.resumeMessages,
        {
          role: "tool",
          content: responseParts,
        } as ModelMessage,
      ])
    } else {
      this.updateContinuationWaitStatus(run, state)
    }
    return request
  }

  answerQuestion(runId: string, requestId: string, answers: QuestionAnswer[]) {
    const run = this.runs.get(runId)
    const state = this.executionState.get(runId)
    if (!run) {
      throw new RuntimeQuestionError("QUESTION_NOT_FOUND", `Run ${runId} not found`, 404)
    }
    if (!state || isTerminalStatus(run.status)) {
      throw new RuntimeQuestionError(
        "QUESTION_RUN_NOT_ACTIVE",
        `Run ${runId} is not waiting for user input`,
        409
      )
    }

    const request = state.questionRequests.get(requestId)
    if (!request || request.runId !== runId) {
      throw new RuntimeQuestionError("QUESTION_NOT_FOUND", `Question request ${requestId} not found`, 404)
    }
    if (request.status !== "pending") {
      throw new RuntimeQuestionError(
        "QUESTION_ALREADY_ANSWERED",
        `Question request ${requestId} has already been resolved`,
        409
      )
    }

    const frame = state.continuations.get(request.frameId)
    if (!frame || frame.kind !== "question" || frame.status !== "waiting") {
      throw new RuntimeQuestionError(
        "QUESTION_RUN_NOT_ACTIVE",
        `Run ${runId} has no resumable question continuation`,
        409
      )
    }

    const normalizedAnswers = normalizeQuestionAnswers(request.questions, answers)
    request.status = "answered"
    request.answers = normalizedAnswers
    request.answeredAt = new Date().toISOString()

    this.emit(this.createQuestionEvent(request, "question.answered", {
      status: "answered",
      answers: normalizedAnswers,
    }))
    this.emit(this.createQuestionToolTerminalEvent(request, "tool.completed", {
      status: "completed",
      summary: "User answered the question request",
      data: {
        requestId: request.requestId,
        answers: normalizedAnswers,
      },
    }))

    const requests = frame.requestIds.map((id) => state.questionRequests.get(id))
    if (requests.every((candidate) => candidate && candidate.status === "answered")) {
      const responseParts = requests.map((candidate) => ({
        type: "tool-result" as const,
        toolCallId: candidate!.toolCallId,
        toolName: "question",
        output: {
          type: "json" as const,
          value: {
            requestId: candidate!.requestId,
            answers: candidate!.answers ?? [],
          },
        },
      }))
      frame.status = "resuming"
      if (frame.taskId) {
        state.activeTaskExecutions.add(frame.executionId)
      }
      this.updateRunStatus(run, "running")
      frame.resolveResume([
        ...frame.resumeMessages,
        {
          role: "tool",
          content: responseParts,
        } as ModelMessage,
      ])
    } else {
      this.updateContinuationWaitStatus(run, state)
    }

    return request
  }

  subscribe(runId: string, handler: RunSubscription): () => void {
    const subscriptions = this.subscriptions.get(runId) ?? new Set<RunSubscription>()
    subscriptions.add(handler)
    this.subscriptions.set(runId, subscriptions)

    return () => {
      subscriptions.delete(handler)
      if (subscriptions.size === 0) {
        this.subscriptions.delete(runId)
      }
    }
  }

  async cancelRun(runId: string): Promise<RunRecord | null> {
    const run = this.runs.get(runId)
    if (!run) {
      log.warn({ runId }, "Run not found for cancellation")
      return null
    }

    if (isTerminalStatus(run.status)) {
      log.warn({ runId, status: run.status }, "Cannot cancel run in terminal status")
      return run
    }

    log.info({ runId, previousStatus: run.status }, "Cancelling run")
    const state = this.executionState.get(runId)
    state?.abortController.abort()
    state?.permissionService.cancelPendingForRun(runId, (event) => this.emit(event))
    if (state) {
      this.cancelPendingQuestionsForRun(run, state)
    }
    for (const frame of state?.continuations.values() ?? []) {
      if (frame.status === "waiting") {
        frame.status = "cancelled"
        frame.resolveResume(null)
      }
    }
    this.updateRunStatus(run, "cancelled")
    const workspaceDiff = await this.resolveWorkspaceDiffSummary(runId)
    state?.workspaceService?.close()
    this.emit(createRunEvent(runId, "run.cancelled", undefined, {
      reason: "cancelled_by_request",
      ...(workspaceDiff ? { workspaceDiff } : {}),
    }))
    log.info({ runId }, "Run cancelled successfully")
    return run
  }

  private resolveExecutor(agent: AgentDefinition): AgentExecutor {
    switch (agent.executorType) {
      case "orchestrator":
        return this.orchestratorExecutor
      case "ai-sdk":
        return this.aiSdkExecutor
      case "mock":
        return this.mockExecutor
      case "external-adapter":
        return this.externalAdapterExecutor
      default:
        return this.mockExecutor
    }
  }

  private async executeRun(
    runId: string,
    agent: AgentDefinition,
    abortController: AbortController
  ): Promise<void> {
    const run = this.runs.get(runId)
    if (!run) {
      log.warn({ runId }, "Run not found during execution")
      return
    }

    try {
      log.info({ runId, agentId: agent.id }, "Starting run execution")
      this.updateRunStatus(run, "running")
      const state = this.executionState.get(runId)
      if (state) {
        await this.resolveWorkspaceDiffBaseline(runId, state)
      }
      this.emit(createRunEvent(runId, "run.started", undefined, {
        entryAgentIds: run.entryAgentIds,
        entryReason: run.entryReason,
      }))
      this.emit(createRunEvent(runId, "agent.entry.resolved", agent.id, {
        entryAgentIds: run.entryAgentIds,
        entryReason: run.entryReason,
      }))

      const pendingTitle = this.startTitleSystemAgent(run, agent, abortController)

      log.info({ runId, agentId: agent.id, executorType: agent.executorType }, "Executing entry agent")
      await this.executeAgentExecution({
        run,
        agent,
        abortController,
        onEvent: (event) => this.emit(event),
      })

      if (abortController.signal.aborted || run.status === "cancelled") {
        log.info({ runId }, "Run aborted after execution loop")
        return
      }

      await this.flushReadySystemAgent(pendingTitle)
      const emittedTitle = this.emitReadyTitleSystemAgent(run, pendingTitle)
      if (!emittedTitle) {
        this.emitFallbackTitleSystemAgent(run, agent, pendingTitle)
        this.cancelPendingSystemAgent(pendingTitle)
      }

      this.updateRunStatus(run, "completed")
      const workspaceDiff = await this.resolveWorkspaceDiffSummary(runId)
      this.emit(createRunEvent(runId, "run.completed", undefined, {
        status: "completed",
        ...(workspaceDiff ? { workspaceDiff } : {}),
      }))
      log.info({ runId }, "Run completed successfully")
    } catch (error) {
      if (run.status === "cancelled") {
        log.info({ runId }, "Run was cancelled, ignoring error")
        return
      }

      const message = error instanceof Error ? error.message : "Run failed"
      run.error = {
        code: error instanceof RunInputValidationError
          ? error.code
          : error instanceof AgentModelResolutionError
            ? error.code
          : error instanceof ExternalAdapterError
            ? error.code
          : error instanceof TaskExecutionError
            ? error.code
            : "RUN_FAILED",
        message,
        details: error instanceof AgentModelResolutionError || error instanceof ExternalAdapterError || error instanceof TaskExecutionError
          ? error.details
          : undefined,
      }
      const workspaceDiff = await this.resolveWorkspaceDiffSummary(runId)
      this.updateRunStatus(run, "failed")
      this.emit(createRunEvent(runId, "run.failed", undefined, {
        ...run.error,
        ...(workspaceDiff ? { workspaceDiff } : {}),
      }))
      log.error({ runId, error: message }, "Run failed")
    } finally {
      if (isTerminalStatus(run.status)) {
        this.executionState.get(runId)?.workspaceService?.close()
      }
    }
  }

  private startTitleSystemAgent(
    run: RunRecord,
    entryAgent: AgentDefinition,
    abortController: AbortController
  ): PendingSystemAgentResult<SystemAgentCompletedData> | null {
    if (!this.systemAgentRunner.shouldRunTitle(run.input)) {
      return null
    }

    const systemAgentAbortController = new AbortController()
    const abortSystemAgent = () => {
      systemAgentAbortController.abort()
    }
    const cancelSystemAgent = () => {
      abortController.signal.removeEventListener("abort", abortSystemAgent)
      abortSystemAgent()
    }
    if (abortController.signal.aborted) {
      systemAgentAbortController.abort()
    } else {
      abortController.signal.addEventListener("abort", abortSystemAgent, { once: true })
    }

    const pending: PendingSystemAgentResult<SystemAgentCompletedData> = {
      settled: false,
      emitted: false,
      result: null,
      wait: Promise.resolve(),
      cancel: cancelSystemAgent,
    }
    pending.wait = Promise.resolve()
      .then(() => this.systemAgentRunner.runTitle({
        runId: run.id,
        input: run.input,
        entryAgent,
        signal: systemAgentAbortController.signal,
      }))
      .then((result) => {
        pending.result = result
        this.emitReadyTitleSystemAgent(run, pending)
      })
      .catch((error) => {
        log.warn(
          {
            runId: run.id,
            agentId: entryAgent.id,
            error: error instanceof Error ? error.message : String(error),
          },
          "Title system agent failed"
        )
        pending.result = null
      })
      .finally(() => {
        abortController.signal.removeEventListener("abort", abortSystemAgent)
        pending.settled = true
      })

    return pending
  }

  private async flushReadySystemAgent(
    pending: PendingSystemAgentResult<unknown> | null
  ): Promise<void> {
    if (!pending || pending.settled) {
      return
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      pending.wait,
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, TITLE_SYSTEM_AGENT_FLUSH_GRACE_MS)
      }),
    ])
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }

  private emitReadyTitleSystemAgent(
    run: RunRecord,
    pending: PendingSystemAgentResult<SystemAgentCompletedData> | null
  ): boolean {
    if (!pending?.result || isTerminalStatus(run.status)) {
      return false
    }

    if (pending.emitted) {
      return true
    }

    this.emit(createRunEvent(run.id, "system_agent.completed", "system:title", pending.result))
    pending.emitted = true
    return true
  }

  private emitFallbackTitleSystemAgent(
    run: RunRecord,
    entryAgent: AgentDefinition,
    pending: PendingSystemAgentResult<SystemAgentCompletedData> | null
  ): boolean {
    if (!pending || pending.emitted || isTerminalStatus(run.status)) {
      return false
    }

    const result = createFallbackTitleSystemAgentResult(run.input, entryAgent)
    if (!result) {
      return false
    }

    this.emit(createRunEvent(run.id, "system_agent.completed", "system:title", result))
    pending.emitted = true
    return true
  }

  private cancelPendingSystemAgent(
    pending: PendingSystemAgentResult<unknown> | null
  ): void {
    if (!pending || pending.settled) {
      return
    }

    pending.cancel()
  }

  private async executeAgentExecution(options: {
    run: RunRecord
    agent: AgentDefinition
    abortController: AbortController
    onEvent: (event: RunEvent) => void
    parentAgentId?: string
    modelSourceAgent?: AgentDefinition
    task?: OrchestratorTask
    groupId?: string
    parentTaskId?: string
    resumeMessages?: ModelMessage[]
    executionId?: string
  }): Promise<RunEvent[]> {
    const {
      run,
      agent,
      abortController,
      onEvent,
      parentAgentId,
      modelSourceAgent,
      task,
      groupId,
      parentTaskId,
      resumeMessages,
      executionId = `execution_${crypto.randomUUID()}`,
    } = options
    const state = this.executionState.get(run.id)
    if (!state) {
      return []
    }
    const executor = this.resolveExecutor(agent)
    const environmentSnapshot = await this.resolveEnvironmentSnapshot(run.id, state)
    const events: RunEvent[] = []
    let pendingFrame: RunContinuationFrame | undefined
    if (task) {
      state.activeTaskExecutions.add(executionId)
      this.updateContinuationWaitStatus(run, state)
    }

    const emitExecutionEvent = (event: RunEvent): void => {
      if (abortController.signal.aborted || run.status === "cancelled") {
        log.info({ runId: run.id, agentId: agent.id }, "Execution aborted before event emission")
        return
      }

      const normalizedEvent = this.assignMessageIndex(
        this.normalizeEvent(event, parentAgentId, task?.taskId, groupId, parentTaskId),
        state
      )
      events.push(normalizedEvent)
      onEvent(normalizedEvent)
    }

    const context: AgentExecutionContext = {
      runId: run.id,
      input: run.input,
      agent,
      signal: abortController.signal,
      parentAgentId,
      modelSourceAgent,
      task,
      groupId,
      parentTaskId,
      emitEvent: emitExecutionEvent,
      workspaceService: state.workspaceService,
      permissionService: state.permissionService,
      environmentSnapshot,
      executionId,
      resumeMessages,
      onApprovalPending: (messages) => {
        const requestIds = state.permissionService.listRequests(run.id)
          .filter((request) => request.executionId === executionId && request.status === "pending")
          .map((request) => request.requestId)
        if (requestIds.length === 0) {
          return
        }
        pendingFrame = this.createContinuationFrame({
          kind: "approval",
          runId: run.id,
          executionId,
          agentId: agent.id,
          taskId: task?.taskId,
          parentAgentId,
          groupId,
          parentTaskId,
          requestIds,
          resumeMessages: messages,
        })
        state.continuations.set(pendingFrame.frameId, pendingFrame)
        state.activeTaskExecutions.delete(executionId)
        this.updateContinuationWaitStatus(run, state)
      },
      onQuestionPending: (request) => {
        const frame = this.createQuestionContinuationFrame({
          run,
          state,
          executionId,
          agent,
          task,
          parentAgentId,
          groupId,
          parentTaskId,
          calls: request.calls,
          resumeMessages: request.resumeMessages,
        })
        if (!frame) {
          return false
        }
        pendingFrame = frame
        state.continuations.set(frame.frameId, frame)
        state.activeTaskExecutions.delete(executionId)
        this.updateContinuationWaitStatus(run, state)
        return true
      },
      createMessageId: () => this.createExecutionMessageId(run.id, state, executionId),
    }

    if (agent.id === "orchestrator") {
      context.executeTask = async (taskToExecute, taskDispatchOptions = {}) => this.executeTask({
        run,
        sourceAgent: agent,
        task: taskToExecute,
        abortController,
        groupId: taskDispatchOptions.groupId,
        parentTaskId: taskDispatchOptions.parentTaskId,
      })

      context.runTask = async (nextTask, dispatchOptions = {}) => {
        const toolResult = await this.toolRegistry.executeTool("run_task", nextTask, {
          ...context,
          executeTask: context.executeTask,
        }, {
          toolCallId: `tool_run_task_${nextTask.taskId}`,
          groupId: dispatchOptions.groupId,
          parentTaskId: dispatchOptions.parentTaskId,
          task: nextTask,
        })

        const taskResult = (
          typeof toolResult.runtime === "object" &&
          toolResult.runtime &&
          "taskResult" in toolResult.runtime
        )
          ? (toolResult.runtime as { taskResult?: TaskExecutionResult }).taskResult
          : undefined

        if (taskResult) {
          return taskResult
        }

        return {
          taskId: nextTask.taskId,
          targetAgentId: nextTask.targetAgentId,
          status: toolResult.status === "cancelled" ? "cancelled" : "failed",
          summary: toolResult.summary,
          dependsOn: nextTask.dependsOn,
          groupId: dispatchOptions.groupId,
          parentTaskId: dispatchOptions.parentTaskId,
          data: toolResult.error,
          events: [],
        } satisfies TaskExecutionResult
      }
    }

    try {
      for await (const event of executor.execute(context)) {
        if (abortController.signal.aborted || run.status === "cancelled") {
          log.info({ runId: run.id, agentId: agent.id }, "Execution aborted during agent event stream")
          break
        }

        emitExecutionEvent(event)
      }

      if (pendingFrame) {
        const nextMessages = await pendingFrame.waitForResume
        if (!nextMessages || abortController.signal.aborted || run.status === "cancelled") {
          return events
        }
        const resumedEvents = await this.executeAgentExecution({
          ...options,
          executionId,
          resumeMessages: nextMessages,
        })
        pendingFrame.status = "completed"
        events.push(...resumedEvents)
      }
    } finally {
      if (task) {
        state.activeTaskExecutions.delete(executionId)
        this.updateContinuationWaitStatus(run, state)
      }
    }

    return events
  }

  private async executeTask(options: {
    run: RunRecord
    sourceAgent: AgentDefinition
    task: OrchestratorTask
    abortController: AbortController
    groupId?: string
    parentTaskId?: string
  }): Promise<TaskExecutionResult> {
    const { run, sourceAgent, task, abortController, groupId, parentTaskId } = options
    const lifecycleEvents: RunEvent[] = []
    const taskParentTaskId = parentTaskId ?? task.dependsOn[0]

    const startedEvent = this.createTaskLifecycleEvent(
      run.id,
      sourceAgent.id,
      "task.started",
      task,
      {
        targetAgentId: task.targetAgentId,
        title: task.title,
        instruction: task.instruction,
        riskLevel: task.riskLevel,
      },
      groupId,
      taskParentTaskId
    )
    lifecycleEvents.push(startedEvent)
    this.emit(startedEvent)

    try {
      const targetAgent = this.resolveTaskTarget(run, sourceAgent, task.targetAgentId)

      if (abortController.signal.aborted || run.status === "cancelled") {
        throw new TaskExecutionError(
          "TASK_EXECUTION_ABORTED",
          "Task execution was cancelled before the target agent started",
          { taskId: task.taskId, targetAgentId: targetAgent.id }
        )
      }

      log.info(
        {
          runId: run.id,
          sourceAgentId: sourceAgent.id,
          taskId: task.taskId,
          targetAgentId: targetAgent.id,
          groupId,
          parentTaskId: taskParentTaskId,
        },
        "Executing delegated task"
      )

      const childEvents = await this.executeAgentExecution({
        run,
        agent: targetAgent,
        abortController,
        parentAgentId: sourceAgent.id,
        modelSourceAgent: targetAgent.tier === "subagent" ? sourceAgent : undefined,
        task,
        groupId,
        parentTaskId: task.taskId,
        onEvent: (event) => this.emit(event),
      })

      lifecycleEvents.push(...childEvents)

      if (abortController.signal.aborted || this.getRun(run.id)?.status === "cancelled") {
        throw new TaskExecutionError(
          "TASK_EXECUTION_ABORTED",
          "Task execution was cancelled",
          { taskId: task.taskId, targetAgentId: targetAgent.id }
        )
      }

      const summary = this.extractTaskSummary(childEvents, targetAgent, task)
      const completedEvent = this.createTaskLifecycleEvent(
        run.id,
        sourceAgent.id,
        "task.completed",
        task,
        {
          targetAgentId: targetAgent.id,
          summary,
          eventCount: childEvents.length,
        },
        groupId,
        taskParentTaskId
      )
      lifecycleEvents.push(completedEvent)
      this.emit(completedEvent)

      log.info(
        {
          runId: run.id,
          sourceAgentId: sourceAgent.id,
          taskId: task.taskId,
          targetAgentId: targetAgent.id,
          eventCount: childEvents.length,
          groupId,
        },
        "Delegated task completed"
      )

      return {
        taskId: task.taskId,
        targetAgentId: targetAgent.id,
        status: "completed",
        summary,
        dependsOn: task.dependsOn,
        groupId,
        parentTaskId: taskParentTaskId,
        data: {
          eventCount: childEvents.length,
        },
        events: lifecycleEvents,
      }
    } catch (error) {
      const taskError = error instanceof TaskExecutionError
        ? error
        : new TaskExecutionError(
            "TASK_EXECUTION_FAILED",
            error instanceof Error ? error.message : "Task execution failed",
            { taskId: task.taskId, targetAgentId: task.targetAgentId }
          )

      const failedEvent = this.createTaskLifecycleEvent(
        run.id,
        sourceAgent.id,
        "task.failed",
        task,
        {
          code: taskError.code,
          message: taskError.message,
          details: taskError.details,
        },
        groupId,
        taskParentTaskId
      )
      lifecycleEvents.push(failedEvent)
      this.emit(failedEvent)

      log.warn(
        {
          runId: run.id,
          sourceAgentId: sourceAgent.id,
          taskId: task.taskId,
          targetAgentId: task.targetAgentId,
          code: taskError.code,
          message: taskError.message,
          groupId,
        },
        "Delegated task failed"
      )

      return {
        taskId: task.taskId,
        targetAgentId: task.targetAgentId,
        status: taskError.code === "TASK_EXECUTION_ABORTED" ? "cancelled" : "failed",
        summary: taskError.message,
        dependsOn: task.dependsOn,
        groupId,
        parentTaskId: taskParentTaskId,
        data: taskError.details,
        events: lifecycleEvents,
      }
    }
  }

  private resolveTaskTarget(
    run: RunRecord,
    sourceAgent: AgentDefinition,
    targetAgentId: string
  ): AgentDefinition {
    if (sourceAgent.delegationPolicy !== "can-delegate") {
      throw new TaskExecutionError(
        "TASK_SOURCE_CANNOT_DELEGATE",
        `Agent ${sourceAgent.id} is not allowed to delegate tasks`,
        { sourceAgentId: sourceAgent.id }
      )
    }

    const targetAgent = this.agentRegistry.getAgent(targetAgentId)
    if (!targetAgent) {
      throw new TaskExecutionError(
        "TASK_TARGET_NOT_FOUND",
        `Target agent ${targetAgentId} does not exist`,
        { targetAgentId }
      )
    }

    if (!targetAgent.enabled) {
      throw new TaskExecutionError(
        "TASK_TARGET_DISABLED",
        `Target agent ${targetAgentId} is disabled`,
        { targetAgentId }
      )
    }

    if (targetAgent.id === sourceAgent.id) {
      throw new TaskExecutionError(
        "TASK_TARGET_NOT_ALLOWED",
        `Agent ${sourceAgent.id} cannot delegate to itself`,
        { sourceAgentId: sourceAgent.id, targetAgentId }
      )
    }

    if (targetAgent.tier === "subagent") {
      if (
        sourceAgent.allowedSubagents.includes(targetAgent.id) &&
        targetAgent.entryPolicy === "not-callable" &&
        targetAgent.delegationPolicy === "delegated-only"
      ) {
        return targetAgent
      }

      throw new TaskExecutionError(
        "TASK_TARGET_NOT_ALLOWED",
        `Agent ${sourceAgent.id} is not allowed to delegate to subagent ${targetAgent.id}`,
        {
          sourceAgentId: sourceAgent.id,
          targetAgentId: targetAgent.id,
        }
      )
    }

    if (targetAgent.tier === "primary") {
      const participantIds = new Set(run.input.participantAgentIds)
      if (
        sourceAgent.id === "orchestrator" &&
        participantIds.has(targetAgent.id) &&
        targetAgent.visibility === "visible" &&
        targetAgent.entryPolicy !== "not-callable"
      ) {
        return targetAgent
      }

      throw new TaskExecutionError(
        "TASK_TARGET_NOT_ALLOWED",
        `Agent ${sourceAgent.id} is not allowed to delegate to primary agent ${targetAgent.id}`,
        {
          sourceAgentId: sourceAgent.id,
          targetAgentId: targetAgent.id,
          participantAgentIds: run.input.participantAgentIds,
        }
      )
    }

    throw new TaskExecutionError(
      "TASK_TARGET_NOT_ALLOWED",
      `Target agent ${targetAgent.id} has unsupported tier ${targetAgent.tier}`,
      {
        sourceAgentId: sourceAgent.id,
        targetAgentId: targetAgent.id,
        tier: targetAgent.tier,
      }
    )
  }

  private extractTaskSummary(
    events: RunEvent[],
    targetAgent: AgentDefinition,
    task: OrchestratorTask
  ): string {
    const lastCompletedMessage = [...events]
      .reverse()
      .find((event) => event.type === "message.completed" && event.agentId === targetAgent.id)

    const content = typeof lastCompletedMessage?.data === "object" && lastCompletedMessage?.data
      ? (lastCompletedMessage.data as { content?: string }).content
      : undefined

    if (content && content.trim().length > 0) {
      return content
    }

    return `${targetAgent.name} completed task "${task.title}".`
  }

  private createTaskLifecycleEvent(
    runId: string,
    sourceAgentId: string,
    type: "task.started" | "task.completed" | "task.failed",
    task: OrchestratorTask,
    data: Record<string, unknown>,
    groupId?: string,
    parentTaskId?: string
  ): RunEvent {
    const event = createRunEvent(runId, type, sourceAgentId, {
      taskId: task.taskId,
      targetAgentId: task.targetAgentId,
      dependsOn: task.dependsOn,
      task,
      ...data,
    })
    event.taskId = task.taskId
    event.parentAgentId = sourceAgentId
    event.parentTaskId = parentTaskId
    event.groupId = groupId
    return event
  }

  private normalizeEvent(
    event: RunEvent,
    parentAgentId?: string,
    taskId?: string,
    groupId?: string,
    parentTaskId?: string
  ): RunEvent {
    return {
      ...event,
      parentAgentId: event.parentAgentId ?? parentAgentId,
      parentTaskId: event.parentTaskId ?? parentTaskId,
      taskId: event.taskId ?? taskId,
      groupId: event.groupId ?? groupId,
    }
  }

  private createExecutionMessageId(
    runId: string,
    state: RunExecutionState,
    executionId: string
  ): string {
    const blockIndex = state.messageBlockCounters.get(executionId) ?? 0
    state.messageBlockCounters.set(executionId, blockIndex + 1)
    return `msg_${runId}_${executionId}_${blockIndex}`
  }

  private assignMessageIndex(
    event: RunEvent,
    state: RunExecutionState | undefined = this.executionState.get(event.runId)
  ): RunEvent {
    if (!state || !event.messageId) {
      return event
    }

    const current = state.messageIndexById.get(event.messageId)
    if (typeof current === "number") {
      event.messageIndex = current
      return event
    }

    const nextIndex = state.nextMessageIndex
    state.nextMessageIndex += 1
    state.messageIndexById.set(event.messageId, nextIndex)
    event.messageIndex = nextIndex
    return event
  }

  private async resolveEnvironmentSnapshot(
    runId: string,
    state: RunExecutionState
  ): Promise<RuntimeEnvironmentSnapshot | undefined> {
    if (state.environmentSnapshot) {
      return state.environmentSnapshot
    }

    try {
      state.environmentSnapshot = await state.environmentSnapshotPromise
      return state.environmentSnapshot
    } catch (error) {
      log.warn(
        {
          runId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Runtime environment snapshot failed"
      )
      return undefined
    }
  }

  private async resolveWorkspaceDiffBaseline(
    runId: string,
    state: RunExecutionState
  ): Promise<WorkspaceDiffBaseline | undefined> {
    if (state.workspaceDiffBaseline) {
      return state.workspaceDiffBaseline
    }

    try {
      state.workspaceDiffBaseline = await state.workspaceDiffBaselinePromise
      return state.workspaceDiffBaseline
    } catch (error) {
      log.warn(
        {
          runId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Workspace diff baseline failed"
      )
      return undefined
    }
  }

  private async resolveWorkspaceDiffSummary(runId: string): Promise<WorkspaceDiffSummary | undefined> {
    const state = this.executionState.get(runId)
    if (!state) {
      return undefined
    }

    try {
      const baseline = await this.resolveWorkspaceDiffBaseline(runId, state)
      const summary = await this.workspaceDiffService.summarize(state.workspaceService, baseline)
      log.info(
        {
          runId,
          status: summary.status,
          baselineDirty: summary.baselineDirty,
          changedFileCount: summary.changedFiles.length,
          limitations: summary.limitations,
        },
        "Workspace diff summary computed"
      )
      return summary
    } catch (error) {
      log.warn(
        {
          runId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Workspace diff summary failed"
      )
      return undefined
    }
  }

  private createWorkspaceSession(runId: string, input: RunInput): WorkspaceService | undefined {
    if (!input.workspace) {
      return undefined
    }

    try {
      return new WorkspaceService({
        runId,
        workspaceId: input.workspace.workspaceId,
        workdir: input.workspace.rootPath,
      })
    } catch (error) {
      throw new RunWorkspaceValidationError(
        "Invalid workspace snapshot for run",
        error instanceof WorkspaceError
          ? { code: error.code }
          : error instanceof Error
            ? { message: "Workspace snapshot could not be opened" }
            : undefined
      )
    }
  }

  private createContinuationFrame(options: {
    frameId?: string
    kind: RunContinuationFrame["kind"]
    runId: string
    executionId: string
    agentId: string
    taskId?: string
    parentAgentId?: string
    groupId?: string
    parentTaskId?: string
    requestIds: string[]
    resumeMessages: ModelMessage[]
  }): RunContinuationFrame {
    let resolveResume!: (messages: ModelMessage[] | null) => void
    const waitForResume = new Promise<ModelMessage[] | null>((resolve) => {
      resolveResume = resolve
    })
    return {
      frameId: options.frameId ?? `frame_${crypto.randomUUID()}`,
      ...options,
      status: "waiting",
      waitForResume,
      resolveResume,
    }
  }

  private createQuestionContinuationFrame(options: {
    run: RunRecord
    state: RunExecutionState
    executionId: string
    agent: AgentDefinition
    task?: OrchestratorTask
    parentAgentId?: string
    groupId?: string
    parentTaskId?: string
    calls: PendingQuestionToolCall[]
    resumeMessages: ModelMessage[]
  }): RunContinuationFrame | undefined {
    const {
      run,
      state,
      executionId,
      agent,
      task,
      parentAgentId,
      groupId,
      parentTaskId,
      calls,
      resumeMessages,
    } = options
    const validRequests: QuestionRequestRecord[] = []
    const frameId = `frame_${crypto.randomUUID()}`

    for (const call of calls) {
      const parsed = QuestionToolInputSchema.safeParse(call.input)
      if (!parsed.success) {
        this.emit(this.createQuestionToolStartedEvent({
          runId: run.id,
          agentId: agent.id,
          toolCallId: call.toolCallId,
          messageId: call.messageId,
          taskId: task?.taskId,
          parentAgentId,
          groupId,
          parentTaskId,
        }))
        this.emit(this.createQuestionToolFailedEvent({
          runId: run.id,
          agentId: agent.id,
          toolCallId: call.toolCallId,
          messageId: call.messageId,
          taskId: task?.taskId,
          parentAgentId,
          groupId,
          parentTaskId,
          summary: "Invalid input for question",
          error: {
            code: "TOOL_INVALID_INPUT",
            message: "Invalid input for question",
            details: parsed.error.issues,
          },
        }))
        continue
      }

      const request: QuestionRequestRecord = {
        requestId: `question_${crypto.randomUUID()}`,
        runId: run.id,
        frameId,
        executionId,
        agentId: agent.id,
        toolCallId: call.toolCallId,
        toolName: "question",
        messageId: call.messageId,
        taskId: task?.taskId,
        parentAgentId,
        groupId,
        parentTaskId,
        questions: normalizeQuestionToolInput(parsed.data),
        status: "pending",
        createdAt: new Date().toISOString(),
      }
      validRequests.push(request)
    }

    if (validRequests.length === 0) {
      return undefined
    }

    for (const request of validRequests) {
      state.questionRequests.set(request.requestId, request)
      this.emit(this.createQuestionToolStartedEvent({
        runId: run.id,
        agentId: agent.id,
        toolCallId: request.toolCallId,
        messageId: request.messageId,
        taskId: request.taskId,
        parentAgentId: request.parentAgentId,
        groupId: request.groupId,
        parentTaskId: request.parentTaskId,
      }))
      this.emit(this.createQuestionEvent(request, "question.requested", {
        status: "pending",
        questions: request.questions,
      }))
    }

    return this.createContinuationFrame({
      kind: "question",
      frameId,
      runId: run.id,
      executionId,
      agentId: agent.id,
      taskId: task?.taskId,
      parentAgentId,
      groupId,
      parentTaskId,
      requestIds: validRequests.map((request) => request.requestId),
      resumeMessages,
    })
  }

  private updateContinuationWaitStatus(run: RunRecord, state: RunExecutionState): void {
    if (isTerminalStatus(run.status)) {
      return
    }
    const waitingFrames = Array.from(state.continuations.values())
      .filter((frame) => frame.status === "waiting")
    if (waitingFrames.length === 0) {
      return
    }
    if (state.activeTaskExecutions.size > 0) {
      this.updateRunStatus(run, "running")
      return
    }

    const hasWaitingApproval = waitingFrames.some((frame) => frame.kind === "approval")
    this.updateRunStatus(run, hasWaitingApproval ? "waiting_approval" : "waiting_input")
  }

  private cancelPendingQuestionsForRun(run: RunRecord, state: RunExecutionState): void {
    for (const request of state.questionRequests.values()) {
      if (request.runId !== run.id || request.status !== "pending") {
        continue
      }

      request.status = "cancelled"
      request.cancelledAt = new Date().toISOString()
      this.emit(this.createQuestionEvent(request, "question.cancelled", {
        status: "cancelled",
      }))
      this.emit(this.createQuestionToolTerminalEvent(request, "tool.failed", {
        status: "cancelled",
        summary: "Question request was cancelled",
        error: {
          code: "QUESTION_CANCELLED",
          message: "Question request was cancelled",
        },
      }))
    }
  }

  private createQuestionEvent(
    request: QuestionRequestRecord,
    type: "question.requested" | "question.answered" | "question.cancelled",
    data: Record<string, unknown>
  ): RunEvent {
    const event = createRunEvent(request.runId, type, request.agentId, {
      requestId: request.requestId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      messageId: request.messageId,
      taskId: request.taskId,
      parentAgentId: request.parentAgentId,
      parentTaskId: request.parentTaskId,
      groupId: request.groupId,
      ...data,
    })
    event.toolCallId = request.toolCallId
    event.toolName = request.toolName
    event.messageId = request.messageId
    event.taskId = request.taskId
    event.parentAgentId = request.parentAgentId ?? request.agentId
    event.parentTaskId = request.parentTaskId
    event.groupId = request.groupId
    return event
  }

  private createQuestionToolStartedEvent(options: {
    runId: string
    agentId: string
    toolCallId: string
    messageId?: string
    taskId?: string
    parentAgentId?: string
    groupId?: string
    parentTaskId?: string
  }): RunEvent {
    const event = createRunEvent(options.runId, "tool.started", options.agentId, {
      riskLevel: "low",
      summary: "Question requested",
    })
    event.toolCallId = options.toolCallId
    event.toolName = "question"
    event.messageId = options.messageId
    event.taskId = options.taskId
    event.parentAgentId = options.parentAgentId ?? options.agentId
    event.parentTaskId = options.parentTaskId
    event.groupId = options.groupId
    return event
  }

  private createQuestionToolFailedEvent(options: {
    runId: string
    agentId: string
    toolCallId: string
    messageId?: string
    taskId?: string
    parentAgentId?: string
    groupId?: string
    parentTaskId?: string
    summary: string
    error: { code: string; message: string; details?: unknown }
  }): RunEvent {
    const event = createRunEvent(options.runId, "tool.failed", options.agentId, {
      status: "failed",
      summary: options.summary,
      error: options.error,
    })
    event.toolCallId = options.toolCallId
    event.toolName = "question"
    event.messageId = options.messageId
    event.taskId = options.taskId
    event.parentAgentId = options.parentAgentId ?? options.agentId
    event.parentTaskId = options.parentTaskId
    event.groupId = options.groupId
    return event
  }

  private createQuestionToolTerminalEvent(
    request: QuestionRequestRecord,
    type: "tool.completed" | "tool.failed",
    data: Record<string, unknown>
  ): RunEvent {
    const event = createRunEvent(request.runId, type, request.agentId, data)
    event.toolCallId = request.toolCallId
    event.toolName = request.toolName
    event.messageId = request.messageId
    event.taskId = request.taskId
    event.parentAgentId = request.parentAgentId ?? request.agentId
    event.parentTaskId = request.parentTaskId
    event.groupId = request.groupId
    return event
  }

  private updateRunStatus(run: RunRecord, status: RunStatus): void {
    run.status = status
    run.updatedAt = new Date().toISOString()
  }

  private emit(event: RunEvent): void {
    const eventToEmit = this.assignMessageIndex(event)
    const events = this.events.get(eventToEmit.runId)
    if (events) {
      events.push(eventToEmit)
    }

    const run = this.runs.get(eventToEmit.runId)
    if (run) {
      run.updatedAt = eventToEmit.timestamp
    }

    const subscriptions = this.subscriptions.get(eventToEmit.runId)
    if (subscriptions) {
      for (const handler of subscriptions) {
        handler(eventToEmit)
      }
    }

    if (isTerminalRunEvent(eventToEmit)) {
      this.subscriptions.delete(eventToEmit.runId)
    }
  }
}
