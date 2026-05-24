import type { AgentDefinition, AgentRegistry } from "../agents"
import type { ProviderService } from "../provider"
import { createChildLogger } from "../logger"
import { EntryResolver, RunInputValidationError } from "./entry-resolver"
import { AiSdkExecutor } from "./ai-sdk-executor"
import { MockExecutor } from "./mock-executor"
import { OrchestratorExecutor } from "./orchestrator-executor"
import { createRunEvent, isTerminalRunEvent, isTerminalStatus } from "./run-events"
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

type RunSubscription = (event: RunEvent) => void

type RunExecutionState = {
  abortController: AbortController
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
  private runs: Map<string, RunRecord> = new Map()
  private events: Map<string, RunEvent[]> = new Map()
  private subscriptions: Map<string, Set<RunSubscription>> = new Map()
  private executionState: Map<string, RunExecutionState> = new Map()

  constructor(
    private agentRegistry: AgentRegistry,
    providerService: ProviderService
  ) {
    this.entryResolver = new EntryResolver(agentRegistry)
    this.aiSdkExecutor = new AiSdkExecutor(providerService)
    this.orchestratorExecutor = new OrchestratorExecutor(agentRegistry)
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
    this.executionState.set(run.id, { abortController })

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
          : error instanceof TaskExecutionError
            ? error.code
            : "RUN_FAILED",
        message,
      }
      this.updateRunStatus(run, "failed")
      this.emit(createRunEvent(runId, "run.failed", undefined, run.error))
      log.error({ runId, error: message }, "Run failed")
    } finally {
      this.executionState.delete(runId)
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
    } = options
    const executor = this.resolveExecutor(agent)
    const events: RunEvent[] = []

    const context: AgentExecutionContext = {
      runId: run.id,
      input: run.input,
      agent,
      signal: abortController.signal,
      parentAgentId,
      task,
      groupId,
      parentTaskId,
    }

    if (agent.id === "orchestrator") {
      context.runTask = async (nextTask, dispatchOptions = {}) => this.executeTask({
        run,
        sourceAgent: agent,
        task: nextTask,
        abortController,
        groupId: dispatchOptions.groupId,
        parentTaskId: dispatchOptions.parentTaskId,
      })
    }

    for await (const event of executor.execute(context)) {
      if (abortController.signal.aborted || run.status === "cancelled") {
        log.info({ runId: run.id, agentId: agent.id }, "Execution aborted during agent event stream")
        break
      }

      const normalizedEvent = this.normalizeEvent(event, parentAgentId, task?.taskId, groupId, parentTaskId)
      events.push(normalizedEvent)
      onEvent(normalizedEvent)
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
      const targetAgent = this.resolveTaskTarget(sourceAgent, task.targetAgentId)

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

  private resolveTaskTarget(sourceAgent: AgentDefinition, targetAgentId: string): AgentDefinition {
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

    const relationExists = this.agentRegistry
      .listRelations({
        enabledOnly: true,
        fromAgentId: sourceAgent.id,
        toAgentId: targetAgent.id,
      })
      .length > 0

    const allowedByPreset = sourceAgent.allowedSubagents.includes(targetAgent.id)

    if (!relationExists && !allowedByPreset) {
      throw new TaskExecutionError(
        "TASK_TARGET_NOT_ALLOWED",
        `Agent ${sourceAgent.id} is not allowed to delegate to ${targetAgent.id}`,
        {
          sourceAgentId: sourceAgent.id,
          targetAgentId: targetAgent.id,
        }
      )
    }

    return targetAgent
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
