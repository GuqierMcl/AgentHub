import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import runsRouter from "../src/routers/runs"
import type { RunEvent } from "../src/runtime"

function runEvent(id: string, type: RunEvent["type"], agentId?: string): RunEvent {
  return {
    id,
    runId: "run_sse_race",
    type,
    timestamp: new Date().toISOString(),
    agentId,
    data: {},
  }
}

function parseSseEvents(payload: string): RunEvent[] {
  return payload
    .split(/\r?\n\r?\n/)
    .flatMap((chunk) => {
      const dataLine = chunk
        .split(/\r?\n/)
        .find((line) => line.startsWith("data:"))
      if (!dataLine) return []
      return [JSON.parse(dataLine.slice(5).trimStart()) as RunEvent]
    })
}

function createRunsApp(manager: unknown): Hono {
  const app = new Hono()
  app.use("*", async (c: Context, next: Next) => {
    c.set("runManager", manager as never)
    await next()
  })
  app.route("/", runsRouter)
  return app
}

describe("runtime run SSE route", () => {
  test("replays tail events when a run completes between initial lookup and stream start", async () => {
    const earlyEvents = [
      runEvent("evt_started", "run.started"),
      runEvent("evt_agent_started", "agent.started", "opencode"),
    ]
    const allEvents = [
      ...earlyEvents,
      runEvent("evt_delta", "message.delta", "opencode"),
      runEvent("evt_message_completed", "message.completed", "opencode"),
      runEvent("evt_agent_completed", "agent.completed", "opencode"),
      runEvent("evt_run_completed", "run.completed"),
    ]
    let getEventsCalls = 0
    let unsubscribed = false
    const manager = {
      getEvents() {
        getEventsCalls += 1
        return getEventsCalls === 1 ? earlyEvents : allEvents
      },
      getRun() {
        return { id: "run_sse_race", status: "completed" }
      },
      subscribe() {
        return () => {
          unsubscribed = true
        }
      },
    }

    const app = createRunsApp(manager)

    const response = await app.request("/runtime/runs/run_sse_race/events")
    const events = parseSseEvents(await response.text())

    expect(response.status).toBe(200)
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "agent.started",
      "message.delta",
      "message.completed",
      "agent.completed",
      "run.completed",
    ])
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length)
    expect(unsubscribed).toBe(true)
  })

  test("sends keepalive comments while waiting for new events", async () => {
    let unsubscribed = false
    const manager = {
      getEvents() {
        return []
      },
      getRun() {
        return { id: "run_sse_idle", status: "running" }
      },
      subscribe() {
        return () => {
          unsubscribed = true
        }
      },
    }
    const app = createRunsApp(manager)

    const response = await app.request("/runtime/runs/run_sse_idle/events")
    const reader = response.body!.getReader()
    const first = await reader.read()
    const payload = new TextDecoder().decode(first.value)
    await reader.cancel()

    expect(response.status).toBe(200)
    expect(payload).toContain(": keepalive\n\n")
    expect(unsubscribed).toBe(true)
  })
})
