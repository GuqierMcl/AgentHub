import { describe, expect, test } from "bun:test"
import {
  runWithPreVisibleFallback,
  type ModelAttempt,
} from "../src/runtime/pre-visible-model-fallback"
import { createRunEvent, type RunEvent } from "../src/runtime"

function event(type: RunEvent["type"], agentId = "coder"): RunEvent {
  return createRunEvent("run_fallback", type, agentId, {})
}

async function collect(iterable: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const events: RunEvent[] = []
  for await (const item of iterable) {
    events.push(item)
  }
  return events
}

describe("pre-visible model fallback", () => {
  test("discards pre-visible events from a failed primary attempt and emits fallback events", async () => {
    const attempts: string[] = []
    const primary: ModelAttempt = { id: "primary" }
    const fallback: ModelAttempt = { id: "fallback" }

    const events = await collect(runWithPreVisibleFallback({
      primary,
      getFallback: () => fallback,
      executeAttempt: async function* (attempt) {
        attempts.push(attempt.id)
        yield event("agent.started")
        if (attempt.id === "primary") {
          yield event("model.stream.part")
          throw new Error("primary failed before visible output")
        }
        yield event("message.delta")
        yield event("message.completed")
        yield event("agent.completed")
      },
    }))

    expect(attempts).toEqual(["primary", "fallback"])
    expect(events.map((item) => item.type)).toEqual([
      "agent.started",
      "message.delta",
      "message.completed",
      "agent.completed",
    ])
  })

  test("does not fallback after a visible event has been emitted", async () => {
    const attempts: string[] = []
    const primary: ModelAttempt = { id: "primary" }
    const fallback: ModelAttempt = { id: "fallback" }

    const events: RunEvent[] = []
    let caught: Error | null = null
    try {
      for await (const item of runWithPreVisibleFallback({
        primary,
        getFallback: () => fallback,
        executeAttempt: async function* (attempt) {
          attempts.push(attempt.id)
          yield event("agent.started")
          yield event("message.delta")
          throw new Error("primary failed after visible output")
        },
      })) {
        events.push(item)
      }
    } catch (error) {
      caught = error as Error
    }

    expect(attempts).toEqual(["primary"])
    expect(events.map((item) => item.type)).toEqual([
      "agent.started",
      "message.delta",
    ])
    expect(caught?.message).toBe("primary failed after visible output")
  })
})
