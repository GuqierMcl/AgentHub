import type { ModelMessage } from "ai"
import { createChildLogger } from "../logger"
import { createRunEvent, isTerminalRunEvent, isTerminalStatus } from "../runtime/run-events"
import type { AgentExecutionContext, RunEvent, RunStatus } from "../runtime/types"
import type { PendingQuestionToolCall, QuestionContinuationRequest } from "../runtime/question"
import {
  normalizeQuestionToolInput,
  normalizeQuestionAnswers,
  QuestionToolInputSchema,
  RuntimeQuestionError,
  type NormalizedQuestionItem,
} from "../runtime/question"
import { InstructAgentExecutor } from "./instruct-agent-executor"
import { InstructAgentRegistry } from "../agents/instruct-agent-registry"
import type {
  InstructRunInput,
  InstructRunRecord,
  InstructRunCreateResponse,
} from "./types"
import type { AgentDefinition } from "../agents"

const log = createChildLogger("instruct-run-manager")

type InstructRunSubscription = (event: RunEvent) => void

type QuestionContinuationRecord = {
  requestId: string
  runId: string
  calls: PendingQuestionToolCall[]
  resumeMessages: ModelMessage[]
  questions: NormalizedQuestionItem[]
  status: "pending" | "answered" | "cancelled"
  agentId: string
  toolCallId: string
  messageId?: string
}

type InstructRunStore = {
  record: InstructRunRecord
  events: RunEvent[]
  subscriptions: Set<InstructRunSubscription>
  questionRecord: QuestionContinuationRecord | null
  abortController: AbortController
}

export class InstructRunManager {
  private runs: Map<string, InstructRunRecord> = new Map()
  private events: Map<string, RunEvent[]> = new Map()
  private subscriptions: Map<string, Set<InstructRunSubscription>> = new Map()
  private stores: Map<string, InstructRunStore> = new Map()

  constructor(
    private agentRegistry: InstructAgentRegistry,
    private executor: InstructAgentExecutor
  ) {}

  createRun(input: InstructRunInput): InstructRunCreateResponse {
    const runId = `run_${crypto.randomUUID()}`
    const agent = this.agentRegistry.getDefaultInstructAgent()

    const now = new Date().toISOString()

    const run: InstructRunRecord = {
      runId,
      conversationId: input.conversationId,
      status: "queued",
      agentId: agent.id,
      createdAt: now,
      updatedAt: now,
      input,
    }

    const abortController = new AbortController()

    const store: InstructRunStore = {
      record: run,
      events: [],
      subscriptions: new Set(),
      questionRecord: null,
      abortController,
    }

    this.runs.set(runId, run)
    this.events.set(runId, [])
    this.stores.set(runId, store)

    log.info({ runId, conversationId: input.conversationId }, "Instruct run created")

    queueMicrotask(() => {
      void this.executeRun(runId, agent, abortController, input).catch((error) => {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        log.error({ runId, error: errorMessage }, "Instruct run execution failed")
        const s = this.stores.get(runId)
        if (s) {
          this.failRun(runId, s, errorMessage)
        }
      })
    })

    return {
      runId,
      status: "queued",
      agentId: "instruct-agent",
      eventsUrl: `/runtime/instruct-runs/${runId}/events`,
    }
  }

  getRun(runId: string): InstructRunRecord | null {
    return this.runs.get(runId) ?? null
  }

  getEvents(runId: string): RunEvent[] | null {
    const events = this.events.get(runId)
    return events ? [...events] : null
  }

  subscribe(runId: string, handler: InstructRunSubscription): () => void {
    const subscriptions = this.subscriptions.get(runId) ?? new Set<InstructRunSubscription>()
    subscriptions.add(handler)
    this.subscriptions.set(runId, subscriptions)

    return () => {
      subscriptions.delete(handler)
      if (subscriptions.size === 0) {
        this.subscriptions.delete(runId)
      }
    }
  }

  answerQuestion(
    runId: string,
    requestId: string,
    answers: Parameters<typeof normalizeQuestionAnswers>[1]
  ): { status: string; requestId: string } {
    const run = this.runs.get(runId)
    if (!run) {
      throw new RuntimeQuestionError("QUESTION_NOT_FOUND", `Run ${runId} not found`, 404)
    }

    if (isTerminalStatus(run.status)) {
      throw new RuntimeQuestionError(
        "QUESTION_RUN_NOT_ACTIVE",
        `Run ${runId} is not waiting for user input`,
        409
      )
    }

    const store = this.stores.get(runId)
    if (!store || !store.questionRecord || store.questionRecord.requestId !== requestId) {
      throw new RuntimeQuestionError("QUESTION_NOT_FOUND", `Question request ${requestId} not found`, 404)
    }

    if (store.questionRecord.status !== "pending") {
      throw new RuntimeQuestionError(
        "QUESTION_ALREADY_ANSWERED",
        `Question request ${requestId} has already been resolved`,
        409
      )
    }

    const normalized = normalizeQuestionAnswers(store.questionRecord.questions, answers)

    store.questionRecord.status = "answered"
    this.updateRunStatus(run, "running")

    const questionAnswered = createRunEvent(runId, "question.answered", store.questionRecord.agentId, {
      requestId,
      answers: normalized,
    })
    questionAnswered.toolCallId = store.questionRecord.toolCallId
    questionAnswered.messageId = store.questionRecord.messageId
    this.emit(questionAnswered)

    const toolCompleted = createRunEvent(runId, "tool.completed", store.questionRecord.agentId, {
      status: "completed",
      summary: "User answered the question request",
      data: {
        requestId: store.questionRecord.requestId,
        answers: normalized,
      },
    })
    toolCompleted.toolCallId = store.questionRecord.toolCallId
    toolCompleted.toolName = "question"
    toolCompleted.messageId = store.questionRecord.messageId
    this.emit(toolCompleted)

    const agent = this.agentRegistry.getDefaultInstructAgent()

    const responseParts = store.questionRecord.calls.map((call) => ({
      type: "tool-result" as const,
      toolCallId: call.toolCallId,
      toolName: "question",
      output: "The user answered the questions.",
    }))

    const resumeMessages: ModelMessage[] = [
      ...store.questionRecord.resumeMessages,
      {
        role: "tool" as const,
        content: responseParts,
      } as ModelMessage,
    ]

    this.executeRun(runId, agent, store.abortController, store.record.input, resumeMessages).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      log.error({ runId, error: errorMessage }, "Instruct run continuation failed")
      const s = this.stores.get(runId)
      if (s) {
        this.failRun(runId, s, errorMessage)
      }
    })

    return { status: "answered", requestId }
  }

  cancelRun(runId: string): InstructRunRecord | null {
    const run = this.runs.get(runId)
    if (!run) {
      log.warn({ runId }, "Run not found for cancellation")
      return null
    }

    if (isTerminalStatus(run.status)) {
      return run
    }

    log.info({ runId, previousStatus: run.status }, "Cancelling instruct run")

    const store = this.stores.get(runId)
    store?.abortController.abort()

    if (store?.questionRecord && store.questionRecord.status === "pending") {
      store.questionRecord.status = "cancelled"
      const questionCancelled = createRunEvent(runId, "question.cancelled", run.agentId, {
        requestId: store.questionRecord.requestId,
      })
      questionCancelled.toolCallId = store.questionRecord.toolCallId
      this.emit(questionCancelled)
    }

    this.updateRunStatus(run, "cancelled")
    this.emit(createRunEvent(runId, "run.cancelled", undefined, {
      reason: "cancelled_by_request",
    }))

    log.info({ runId }, "Instruct run cancelled")
    return run
  }

  private updateRunStatus(run: InstructRunRecord, status: RunStatus): void {
    run.status = status
    run.updatedAt = new Date().toISOString()
  }

  private async executeRun(
    runId: string,
    agent: AgentDefinition,
    abortController: AbortController,
    input: InstructRunInput,
    resumeMessages?: ModelMessage[]
  ): Promise<void> {
    const run = this.runs.get(runId)
    if (!run) {
      log.warn({ runId }, "Run not found during execution")
      return
    }

    const store = this.stores.get(runId)
    if (!store) {
      log.warn({ runId }, "Run store not found during execution")
      return
    }

    try {
      log.info({ runId, agentId: agent.id }, "Starting instruct run execution")
      this.updateRunStatus(run, "running")
      this.emit(createRunEvent(runId, "run.started", agent.id, {}))

      const context: AgentExecutionContext = {
        runId,
        agent,
        signal: abortController.signal,
        input: input as any,
        executionId: runId,
        resumeMessages,
        onQuestionPending: (request: QuestionContinuationRequest): boolean => {
          if (abortController.signal.aborted) {
            return false
          }

          const toolCallId = request.calls[0]?.toolCallId ?? `tool_${crypto.randomUUID()}`
          const messageId = request.calls[0]?.messageId
          const requestId = `question_${crypto.randomUUID()}`

          const parsed = QuestionToolInputSchema.safeParse(request.calls[0]?.input)
          const questions = parsed.success
            ? normalizeQuestionToolInput(parsed.data)
            : normalizeQuestionToolInput({ questions: [] })

          store.questionRecord = {
            requestId,
            runId,
            calls: request.calls,
            resumeMessages: request.resumeMessages,
            questions,
            status: "pending",
            agentId: agent.id,
            toolCallId,
            messageId,
          }

          this.updateRunStatus(run, "waiting_input")

          const questionRequested = createRunEvent(runId, "question.requested", agent.id, {
            requestId,
            questions,
          })
          questionRequested.toolCallId = toolCallId
          questionRequested.messageId = messageId
          this.emit(questionRequested)

          return true
        },
      }

      const events: RunEvent[] = []
      for await (const event of this.executor.execute(context)) {
        if (abortController.signal.aborted || run.status === "cancelled") {
          log.info({ runId, agentId: agent.id }, "Instruct execution aborted")
          return
        }

        events.push(event)
        this.emit(event)
      }

      if (abortController.signal.aborted || run.status === "cancelled") {
        return
      }

      if (store.questionRecord?.status === "pending") {
        return
      }

      this.updateRunStatus(run, "completed")
      this.emit(createRunEvent(runId, "run.completed", undefined, {
        status: "completed",
      }))

      log.info({ runId }, "Instruct run completed")
    } catch (error) {
      if (run.status === "cancelled") {
        log.info({ runId }, "Run was cancelled, ignoring error")
        return
      }

      const message = error instanceof Error ? error.message : "Run failed"
      run.error = {
        code: "INSTRUCT_RUN_FAILED",
        message,
      }
      this.updateRunStatus(run, "failed")
      this.emit(createRunEvent(runId, "run.failed", undefined, {
        ...run.error,
      }))

      log.error({ runId, error: message }, "Instruct run failed")
    }
  }

  private failRun(runId: string, store: InstructRunStore, message: string): void {
    const run = store.record
    run.error = {
      code: "INSTRUCT_RUN_FAILED",
      message,
    }
    this.updateRunStatus(run, "failed")
    this.emit(createRunEvent(runId, "run.failed", undefined, {
      ...run.error,
    }))

    log.error({ runId, error: message }, "Instruct run failed")
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
        try {
          handler(event)
        } catch (subscriptionError) {
          log.warn({ eventType: event.type }, "Instruct subscription error")
        }
      }
    }

    if (isTerminalRunEvent(event)) {
      this.subscriptions.delete(event.runId)
    }
  }
}
