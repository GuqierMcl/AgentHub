import type { AgentDefinition, AgentRegistry } from "../agents"
import type { ModelMessage } from "ai"
import type { ProviderService } from "../provider"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createChildLogger } from "../logger"
import { EntryResolver, RunInputValidationError } from "./entry-resolver"
import { AiSdkExecutor } from "./ai-sdk-executor"
import { AgentModelResolutionError } from "./model-resolver"
import { MockExecutor } from "./mock-executor"
import { OrchestratorExecutor } from "./orchestrator-executor"
import { createRunEvent, isTerminalRunEvent, isTerminalStatus } from "./run-events"
import { RuntimeToolRegistry, createDefaultRuntimeToolRegistry } from "./tools"
import { RuntimePermissionError, RuntimePermissionService } from "./permissions"
import { WorkspaceService } from "./workspace"
import type {
  AgentExecutionContext,
  AgentExecutor,
  OrchestratorTask,
  RunEvent,
  RunInput,
  RunRecord,
  RunStatus,
  TaskExecutionResult,
} from "./types"

const log = createChildLogger("run-manager")

function resolveDefaultWorkspaceRoot(): string {
  return join(tmpdir(), "agent-runtime-workspace")
}

type RunSubscription = (event: RunEvent) => void

type RunExecutionState = {
  abortController: AbortController
  entryAgent: AgentDefinition
  continuationMessages?: ModelMessage[]
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
  private toolRegistry: RuntimeToolRegistry
  private workspaceService: WorkspaceService
  private permissionService: RuntimePermissionService
  private runs: Map<string, RunRecord> = new Map()
  private events: Map<string, RunEvent[]> = new Map()
  private subscriptions: Map<string, Set<RunSubscription>> = new Map()
  private executionState: Map<string, RunExecutionState> = new Map()

  constructor(
    private agentRegistry: AgentRegistry,
    providerService: ProviderService,
    workspaceService?: WorkspaceService,
    toolRegistry: RuntimeToolRegistry = createDefaultRuntimeToolRegistry(),
    permissionService?: RuntimePermissionService
  ) {
    this.entryResolver = new EntryResolver(agentRegistry)
    this.toolRegistry = toolRegistry
    this.aiSdkExecutor = new AiSdkExecutor(providerService, this.toolRegistry)
    this.orchestratorExecutor = new OrchestratorExecutor(agentRegistry, providerService, this.toolRegistry)
    this.workspaceService = workspaceService ?? new WorkspaceService({
      workdir: resolveDefaultWorkspaceRoot(),
    })
    this.permissionService = permissionService ?? new RuntimePermissionService(this.workspaceService)
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

    this.runs.set(run.id, run)
    this.events.set(run.id, [])

    const abortController = new AbortController()
    this.executionState.set(run.id, { abortController, entryAgent: resolution.entryAgents[0] })

    log.info({ runId: run.id, entryAgentId: resolution.entryAgents[0].id }, "Run created, scheduling execution")
    queueMicrotask(() => {
      void this.executeRun(run.id, resolution.entryAgents[0], abortController)
    })

    return run
  }

  getRun(runId: string): RunRecord | null {
    return this.runs.get(runId) ?? null
  }

  getEvents(runId: string): RunEvent[] | null {
    const events = this.events.get(runId)
    return events ? [...events] : null
  }

  listPermissions(runId: string) {
    return this.permissionService.listRequests(runId)
  }

  decidePermission(runId: string, requestId: string, approved: boolean, reason?: string) {
    const run = this.runs.get(runId)
    const state = this.executionState.get(runId)
    if (!run) {
      throw new RuntimePermissionError("PERMISSION_NOT_FOUND", `Run ${runId} not found`, 404)
    }
    if (!state || run.status !== "waiting_approval") {
      throw new RuntimePermissionError(
        "PERMISSION_RUN_NOT_ACTIVE",
        `Run ${runId} is not waiting for approval`,
        409
      )
    }

    const currentRequest = this.permissionService.getRequest(requestId)
    if (!currentRequest || currentRequest.runId !== runId) {
      throw new RuntimePermissionError("PERMISSION_NOT_FOUND", `Permission request ${requestId} not found`, 404)
    }
    if (!currentRequest.approvalId || !state.continuationMessages) {
      throw new RuntimePermissionError(
        "PERMISSION_RUN_NOT_ACTIVE",
        `Run ${runId} has no resumable approval continuation`,
        409
      )
    }
    const request = this.permissionService.decide(requestId, { approved, reason }, (event) => this.emit(event))

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
      failed.parentAgentId = request.agentId
      this.emit(failed)
    }

    const messages: ModelMessage[] = [
      ...state.continuationMessages,
      {
        role: "tool",
        content: [{
          type: "tool-approval-response",
          approvalId: request.approvalId,
          approved,
          reason,
        }],
      } as ModelMessage,
    ]
    state.continuationMessages = undefined
    queueMicrotask(() => {
      void this.executeRun(runId, state.entryAgent, state.abortController, true, messages)
    })
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
    this.permissionService.cancelPendingForRun(runId, (event) => this.emit(event))
    this.updateRunStatus(run, "cancelled")
    this.emit(createRunEvent(runId, "run.cancelled", undefined, {
      reason: "cancelled_by_request",
    }))
    this.executionState.delete(runId)
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
    abortController: AbortController,
    resumed = false,
    resumeMessages?: ModelMessage[]
  ): Promise<void> {
    const run = this.runs.get(runId)
    if (!run) {
      log.warn({ runId }, "Run not found during execution")
      return
    }

    try {
      log.info({ runId, agentId: agent.id }, "Starting run execution")
      this.updateRunStatus(run, "running")
      if (!resumed) {
        this.emit(createRunEvent(runId, "run.started", undefined, {
          entryAgentIds: run.entryAgentIds,
          entryReason: run.entryReason,
        }))
        this.emit(createRunEvent(runId, "agent.entry.resolved", agent.id, {
          entryAgentIds: run.entryAgentIds,
          entryReason: run.entryReason,
        }))
      }

      log.info({ runId, agentId: agent.id, executorType: agent.executorType }, "Executing entry agent")
      await this.executeAgentExecution({
        run,
        agent,
        abortController,
        resumeMessages,
        onEvent: (event) => this.emit(event),
      })

      if (abortController.signal.aborted || run.status === "cancelled" || run.status === "waiting_approval") {
        log.info({ runId }, "Run aborted after execution loop")
        return
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
      if (run.status !== "waiting_approval") {
        this.executionState.delete(runId)
      }
    }
  }

  private async executeAgentExecution(options: {
    run: RunRecord
    agent: AgentDefinition
    abortController: AbortController
    onEvent: (event: RunEvent) => void
    parentAgentId?: string
    task?: OrchestratorTask
    groupId?: string
    parentTaskId?: string
    resumeMessages?: ModelMessage[]
  }): Promise<RunEvent[]> {
    const {
      run,
      agent,
      abortController,
      onEvent,
      parentAgentId,
      task,
      groupId,
      parentTaskId,
      resumeMessages,
    } = options
    const executor = this.resolveExecutor(agent)
    const events: RunEvent[] = []

    const emitExecutionEvent = (event: RunEvent): void => {
      if (abortController.signal.aborted || run.status === "cancelled") {
        log.info({ runId: run.id, agentId: agent.id }, "Execution aborted before event emission")
        return
      }

      const normalizedEvent = this.normalizeEvent(event, parentAgentId, task?.taskId, groupId, parentTaskId)
      events.push(normalizedEvent)
      onEvent(normalizedEvent)
    }

    const context: AgentExecutionContext = {
      runId: run.id,
      input: run.input,
      agent,
      signal: abortController.signal,
      parentAgentId,
      task,
      groupId,
      parentTaskId,
      emitEvent: emitExecutionEvent,
      workspaceService: this.workspaceService,
      permissionService: this.permissionService,
      resumeMessages,
      onApprovalPending: (messages) => {
        const state = this.executionState.get(run.id)
        if (state) {
          state.continuationMessages = messages
        }
        this.updateRunStatus(run, "waiting_approval")
      },
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

    for await (const event of executor.execute(context)) {
      if (abortController.signal.aborted || run.status === "cancelled") {
        log.info({ runId: run.id, agentId: agent.id }, "Execution aborted during agent event stream")
        break
      }

      emitExecutionEvent(event)
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

  private updateRunStatus(run: RunRecord, status: RunStatus): void {
    run.status = status
    run.updatedAt = new Date().toISOString()
  }

  private emit(event: RunEvent): void {
    const events = this.events.get(event.runId)
    if (events) {
      events.push(event)
    }

    const run = this.runs.get(event.runId)
    if (run) {
      run.updatedAt = event.timestamp
    }

    const subscriptions = this.subscriptions.get(event.runId)
    if (subscriptions) {
      for (const handler of subscriptions) {
        handler(event)
      }
    }

    if (isTerminalRunEvent(event)) {
      this.subscriptions.delete(event.runId)
    }
  }
}
