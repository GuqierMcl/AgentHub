import type { AgentDefinition, AgentRegistry } from "../agents"
import type { ModelMessage } from "ai"
import type { ProviderService } from "../provider"
import { createChildLogger } from "../logger"
import { EntryResolver, RunInputValidationError } from "./entry-resolver"
import { AiSdkExecutor } from "./ai-sdk-executor"
import { AgentModelResolutionError } from "./model-resolver"
import { MockExecutor } from "./mock-executor"
import { OrchestratorExecutor } from "./orchestrator-executor"
import { createRunEvent, isTerminalRunEvent, isTerminalStatus } from "./run-events"
import { SystemAgentRunner, type SystemAgentCompletedData } from "./system-agents"
import { RuntimeToolRegistry, createDefaultRuntimeToolRegistry } from "./tools"
import { RuntimePermissionError, RuntimePermissionService } from "./permissions"
import { WorkspaceError, WorkspaceService } from "./workspace"
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
} from "./types"

const log = createChildLogger("run-manager")

type RunSubscription = (event: RunEvent) => void

type ApprovalContinuationFrame = {
  frameId: string
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
  waitForDecision: Promise<ModelMessage[] | null>
  resolveDecision: (messages: ModelMessage[] | null) => void
}

type RunExecutionState = {
  abortController: AbortController
  entryAgent: AgentDefinition
  workspaceService?: WorkspaceService
  permissionService: RuntimePermissionService
  continuations: Map<string, ApprovalContinuationFrame>
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
  private mockExecutor = new MockExecutor()
  private orchestratorExecutor: OrchestratorExecutor
  private systemAgentRunner: SystemAgentRunner
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
    const permissionService = new RuntimePermissionService(workspaceService)

    this.runs.set(run.id, run)
    this.events.set(run.id, [])
    this.executionState.set(run.id, {
      abortController,
      entryAgent: resolution.entryAgents[0],
      workspaceService,
      permissionService,
      continuations: new Map(),
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
      candidate.status === "waiting" && candidate.requestIds.includes(requestId)
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
      frame.resolveDecision([
        ...frame.resumeMessages,
        {
          role: "tool",
          content: responseParts,
        } as ModelMessage,
      ])
    } else {
      this.updateApprovalWaitStatus(run, state)
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

  cancelRun(runId: string): RunRecord | null {
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
    for (const frame of state?.continuations.values() ?? []) {
      if (frame.status === "waiting") {
        frame.status = "cancelled"
        frame.resolveDecision(null)
      }
    }
    state?.workspaceService?.close()
    this.updateRunStatus(run, "cancelled")
    this.emit(createRunEvent(runId, "run.cancelled", undefined, {
      reason: "cancelled_by_request",
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
        return this.mockExecutor
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
        this.cancelPendingSystemAgent(pendingTitle)
      }

      this.updateRunStatus(run, "completed")
      this.emit(createRunEvent(runId, "run.completed", undefined, {
        status: "completed",
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
          : error instanceof TaskExecutionError
            ? error.code
            : "RUN_FAILED",
        message,
        details: error instanceof AgentModelResolutionError || error instanceof TaskExecutionError
          ? error.details
          : undefined,
      }
      this.updateRunStatus(run, "failed")
      this.emit(createRunEvent(runId, "run.failed", undefined, run.error))
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
    const events: RunEvent[] = []
    let pendingFrame: ApprovalContinuationFrame | undefined
    if (task) {
      state.activeTaskExecutions.add(executionId)
      this.updateApprovalWaitStatus(run, state)
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
        this.updateApprovalWaitStatus(run, state)
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
        const nextMessages = await pendingFrame.waitForDecision
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
        this.updateApprovalWaitStatus(run, state)
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
    runId: string
    executionId: string
    agentId: string
    taskId?: string
    parentAgentId?: string
    groupId?: string
    parentTaskId?: string
    requestIds: string[]
    resumeMessages: ModelMessage[]
  }): ApprovalContinuationFrame {
    let resolveDecision!: (messages: ModelMessage[] | null) => void
    const waitForDecision = new Promise<ModelMessage[] | null>((resolve) => {
      resolveDecision = resolve
    })
    return {
      frameId: `frame_${crypto.randomUUID()}`,
      ...options,
      status: "waiting",
      waitForDecision,
      resolveDecision,
    }
  }

  private updateApprovalWaitStatus(run: RunRecord, state: RunExecutionState): void {
    if (isTerminalStatus(run.status)) {
      return
    }
    const hasWaitingFrame = Array.from(state.continuations.values())
      .some((frame) => frame.status === "waiting")
    if (!hasWaitingFrame) {
      return
    }
    this.updateRunStatus(run, state.activeTaskExecutions.size > 0 ? "running" : "waiting_approval")
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
