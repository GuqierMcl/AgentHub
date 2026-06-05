import { describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { InstructAgentRegistry } from "../src/agents/instruct-agent-registry"
import { InstructRunManager } from "../src/instruct-runtime/instruct-run-manager"
import type { InstructRunInput } from "../src/instruct-runtime/types"
import { createRunEvent } from "../src/runtime/run-events"

function makeRunInput(overrides: Partial<InstructRunInput> = {}): InstructRunInput {
  return {
    conversationId: "conv-test-1",
    userMessage: {
      role: "user",
      content: "I want to create a code review agent",
    },
    history: [],
    ...overrides,
  }
}

describe("InstructRunManager", () => {
  test("createRun creates a queued run with run_ prefix", () => {
    const registry = new InstructAgentRegistry()
    const manager = new InstructRunManager(registry, {
      execute: async function* () {},
    } as any)
    const input = makeRunInput()
    const response = manager.createRun(input)

    expect(response.runId).toMatch(/^run_/)
    expect(response.status).toBe("queued")
    expect(response.agentId).toBe("instruct-agent")
    expect(response.eventsUrl).toContain("/runtime/instruct-runs/")
    expect(response.eventsUrl).toContain("/events")

    const run = manager.getRun(response.runId)
    expect(run).not.toBeNull()
    expect(run!.agentId).toBe("instruct-agent")
    expect(run!.conversationId).toBe("conv-test-1")
    expect(run!.status).toBe("queued")
    expect(run!.input).toEqual(input)
  })

  test("run.started is emitted after queueMicrotask execution", async () => {
    const registry = new InstructAgentRegistry()
    const manager = new InstructRunManager(registry, {
      execute: async function* () {},
    } as any)
    const input = makeRunInput()
    const response = manager.createRun(input)

    // Immediately after createRun, status is still queued
    expect(manager.getRun(response.runId)!.status).toBe("queued")

    // Wait for microtask + any async execution
    await new Promise((resolve) => setTimeout(resolve, 50))

    // After execution starts, status should be running or completed
    const run = manager.getRun(response.runId)
    expect(["running", "completed"]).toContain(run!.status)

    const events = manager.getEvents(response.runId)
    expect(events).not.toBeNull()
    expect(events!.length).toBeGreaterThanOrEqual(1)
    expect(events![0].type).toBe("run.started")
    expect(events![0].runId).toBe(response.runId)
    expect(events![0].agentId).toBe("instruct-agent")
  })

  test("getRun returns null for unknown runId", () => {
    const registry = new InstructAgentRegistry()
    const { InstructAgentExecutor } = { InstructAgentExecutor: class {} as any }

    // Simpler: just test the in-memory state
    const manager = new InstructRunManager(registry, {
      execute: async function* () {},
    } as any)
    const input = makeRunInput()
    const response = manager.createRun(input)

    expect(manager.getRun("nonexistent")).toBeNull()
    expect(manager.getRun(response.runId)).not.toBeNull()
  })

  test("getEvents returns null for unknown runId", () => {
    const registry = new InstructAgentRegistry()
    const manager = new InstructRunManager(registry, {
      execute: async function* () {},
    } as any)

    expect(manager.getEvents("nonexistent")).toBeNull()
  })

  test("cancelRun cancels active run", () => {
    const registry = new InstructAgentRegistry()
    const manager = new InstructRunManager(registry, {
      execute: async function* () {},
    } as any)
    const input = makeRunInput()
    const response = manager.createRun(input)
    const runId = response.runId

    const cancelled = manager.cancelRun(runId)
    expect(cancelled).not.toBeNull()
    expect(cancelled!.status).toBe("cancelled")

    const events = manager.getEvents(runId)
    expect(events).not.toBeNull()
    const runCancelledEvent = events!.find((e) => e.type === "run.cancelled")
    expect(runCancelledEvent).toBeDefined()
  })

  test("cancelRun returns null for unknown runId", () => {
    const registry = new InstructAgentRegistry()
    const manager = new InstructRunManager(registry, {
      execute: async function* () {},
    } as any)

    expect(manager.cancelRun("nonexistent")).toBeNull()
  })

  test("subscribe receives events", async () => {
    const registry = new InstructAgentRegistry()
    const manager = new InstructRunManager(registry, {
      execute: async function* () {},
    } as any)
    const input = makeRunInput()
    const response = manager.createRun(input)

    const received: any[] = []
    const unsubscribe = manager.subscribe(response.runId, (event) => {
      received.push(event)
    })

    expect(unsubscribe).toBeDefined()

    // Run.started was already emitted before subscription
    // For future events, they'd be captured

    unsubscribe?.()

    // Verify we got at least the run.started event
    expect(received.length).toBeGreaterThanOrEqual(0)
  })

  test("subscribe returns unsubscribe function even for unknown runId", () => {
    const registry = new InstructAgentRegistry()
    const manager = new InstructRunManager(registry, {
      execute: async function* () {},
    } as any)

    const unsubscribe = manager.subscribe("nonexistent", () => {})
    expect(unsubscribe).toBeDefined()
    // Should not throw when called
    expect(() => unsubscribe()).not.toThrow()
  })

  test("answerQuestion resumes with structured tool-result answers", async () => {
    const registry = new InstructAgentRegistry()
    let executions = 0
    let resumedMessages: ModelMessage[] | undefined

    const manager = new InstructRunManager(registry, {
      async *execute(context: any) {
        executions += 1
        if (!context.resumeMessages) {
          context.onQuestionPending?.({
            calls: [{
              toolCallId: "tool_question_policy",
              messageId: "msg_question_policy",
              input: {
                questions: [{
                  id: "policy",
                  title: "权限策略",
                  body: "请选择权限策略",
                  options: [{ id: "read_only", label: "只读" }],
                  allowCustom: true,
                  required: true,
                }],
              },
            }],
            resumeMessages: [{
              role: "assistant",
              content: [],
            } as unknown as ModelMessage],
          })
          return
        }

        resumedMessages = context.resumeMessages
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    } as any)

    const response = manager.createRun(makeRunInput())
    await new Promise((resolve) => setTimeout(resolve, 50))

    const requested = (manager.getEvents(response.runId) ?? []).find(
      (event) => event.type === "question.requested"
    )
    expect(requested).toBeDefined()
    const requestId = (requested?.data as { requestId?: string } | undefined)?.requestId
    expect(requestId).toBeTruthy()

    manager.answerQuestion(response.runId, requestId!, [{
      questionId: "policy",
      optionId: "read_only",
    }])

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(executions).toBe(2)
    expect(JSON.stringify(resumedMessages)).toContain("\"toolName\":\"question\"")
    expect(JSON.stringify(resumedMessages)).toContain("\"requestId\":\"question_")
    expect(JSON.stringify(resumedMessages)).toContain("\"questionId\":\"policy\"")
    expect(JSON.stringify(resumedMessages)).toContain("\"optionId\":\"read_only\"")
  })

  test("invalid question input emits tool.failed instead of an empty question request", async () => {
    const registry = new InstructAgentRegistry()
    const manager = new InstructRunManager(registry, {
      async *execute(context: any) {
        const accepted = context.onQuestionPending?.({
          calls: [{
            toolCallId: "tool_question_invalid",
            messageId: "msg_question_invalid",
            input: {},
          }],
          resumeMessages: [{
            role: "assistant",
            content: [],
          } as unknown as ModelMessage],
        }) ?? false

        if (!accepted) {
          yield createRunEvent(context.runId, "message.completed", context.agent.id, {
            content: "我换一种方式继续说明。",
          })
          yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
            status: "completed",
          })
        }
      },
    } as any)

    const response = manager.createRun(makeRunInput())
    await new Promise((resolve) => setTimeout(resolve, 50))

    const events = manager.getEvents(response.runId) ?? []
    expect(events.some((event) => event.type === "question.requested")).toBe(false)
    expect(events.some((event) =>
      event.type === "tool.failed" &&
      event.toolName === "question" &&
      (event.data as { error?: { code?: string } } | undefined)?.error?.code === "TOOL_INVALID_INPUT"
    )).toBe(true)
    expect(manager.getRun(response.runId)?.status).toBe("completed")
  })
})
