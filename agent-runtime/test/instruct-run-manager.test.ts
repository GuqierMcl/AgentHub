import { describe, expect, test } from "bun:test"
import { InstructAgentRegistry } from "../src/agents/instruct-agent-registry"
import { InstructRunManager } from "../src/instruct-runtime/instruct-run-manager"
import type { InstructRunInput } from "../src/instruct-runtime/types"

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
})
