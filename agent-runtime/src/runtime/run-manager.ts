import type { AgentRegistry } from "../agents"
import { createChildLogger } from "../logger"
import { EntryResolver, RunInputValidationError } from "./entry-resolver"
import { MockExecutor } from "./mock-executor"
import { createRunEvent, isTerminalRunEvent, isTerminalStatus } from "./run-events"
import type {
  RunEvent,
  RunInput,
  RunRecord,
  RunStatus,
} from "./types"

const log = createChildLogger("run-manager")

type RunSubscription = (event: RunEvent) => void

type RunExecutionState = {
  abortController: AbortController
}

export class RunManager {
  private entryResolver: EntryResolver
  private mockExecutor = new MockExecutor()
  private runs: Map<string, RunRecord> = new Map()
  private events: Map<string, RunEvent[]> = new Map()
  private subscriptions: Map<string, Set<RunSubscription>> = new Map()
  private executionState: Map<string, RunExecutionState> = new Map()

  constructor(agentRegistry: AgentRegistry) {
    this.entryResolver = new EntryResolver(agentRegistry)
  }

  createRun(input: RunInput): RunRecord {
    log.info("Resolving entry agent for run")
    const resolution = this.entryResolver.resolve(input)
    log.info({ entryAgentIds: resolution.entryAgentIds, entryReason: resolution.entryReason }, "Entry agent resolved")

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

    log.info({ runId: run.id }, "Run created, scheduling execution")
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

  private async executeRun(
    runId: string,
    agent: NonNullable<ReturnType<EntryResolver["resolve"]>["entryAgents"][number]>,
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

      log.info({ runId, agentId: agent.id, executorType: agent.executorType }, "Executing agent")
      for await (const event of this.mockExecutor.execute({
        runId,
        input: run.input,
        agent,
        signal: abortController.signal,
      })) {
        if (abortController.signal.aborted || run.status === "cancelled") {
          log.info({ runId }, "Run aborted during execution")
          return
        }
        this.emit(event)
      }

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
        code: error instanceof RunInputValidationError ? error.code : "RUN_FAILED",
        message,
      }
      this.updateRunStatus(run, "failed")
      this.emit(createRunEvent(runId, "run.failed", undefined, run.error))
      log.error({ runId, error: message }, "Run failed")
    } finally {
      if (run.status !== "cancelled") {
        this.executionState.delete(runId)
      }
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

