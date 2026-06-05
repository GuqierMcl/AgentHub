import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import { InstructAgentRegistry } from "../src/agents/instruct-agent-registry"
import { InstructRunManager } from "../src/instruct-runtime"
import instructRunsRouter from "../src/routers/instruct-runs"

function createTestApp(): Hono {
  const app = new Hono()
  const registry = new InstructAgentRegistry()
  const manager = new InstructRunManager(registry, {
    execute: async function* () {},
  } as any)

  app.use("*", async (c: Context, next: Next) => {
    c.set("instructAgentRegistry", registry)
    c.set("instructRunManager", manager)
    await next()
  })
  app.route("/", instructRunsRouter)
  return app
}

describe("instruct-runs router", () => {
  test("POST /runtime/instruct-runs with valid input returns 201", async () => {
    const app = createTestApp()

    const res = await app.request("/runtime/instruct-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: "conv-1",
        userMessage: {
          role: "user",
          content: "Create a code reviewer agent",
        },
        history: [],
      }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.runId).toBeTruthy()
    expect(body.status).toBe("queued")
    expect(body.agentId).toBe("instruct-agent")
    expect(body.eventsUrl).toContain("/runtime/instruct-runs/")
    expect(body.eventsUrl).toContain("/events")
  })

  test("POST /runtime/instruct-runs with invalid input returns 400", async () => {
    const app = createTestApp()

    const res = await app.request("/runtime/instruct-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Missing required fields
        conversationId: "",
        userMessage: { role: "assistant", content: "" },
      }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe("INSTRUCT_RUN_INVALID_INPUT")
  })

  test("POST /runtime/instruct-runs with invalid JSON returns 400", async () => {
    const app = createTestApp()

    const res = await app.request("/runtime/instruct-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe("INSTRUCT_RUN_INVALID_INPUT")
  })

  test("GET /runtime/instruct-runs/:runId returns run", async () => {
    const app = createTestApp()

    // First create a run
    const createRes = await app.request("/runtime/instruct-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: "conv-2",
        userMessage: { role: "user", content: "Test" },
        history: [],
      }),
    })
    const created = await createRes.json()

    const res = await app.request(`/runtime/instruct-runs/${created.runId}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.runId).toBe(created.runId)
    expect(body.agentId).toBe("instruct-agent")
  })

  test("GET /runtime/instruct-runs/:runId not found returns 404", async () => {
    const app = createTestApp()

    const res = await app.request("/runtime/instruct-runs/nonexistent")
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe("RUN_NOT_FOUND")
  })

  test("POST /runtime/instruct-runs/:runId/cancel cancels run", async () => {
    const app = createTestApp()

    // Create a run first
    const createRes = await app.request("/runtime/instruct-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: "conv-3",
        userMessage: { role: "user", content: "Test" },
        history: [],
      }),
    })
    const created = await createRes.json()

    const res = await app.request(`/runtime/instruct-runs/${created.runId}/cancel`, {
      method: "POST",
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    // Run may have completed before cancel due to fast no-op executor
    expect(["cancelled", "completed"]).toContain(body.status)
  })

  test("POST /runtime/instruct-runs/:runId/cancel unknown run returns 404", async () => {
    const app = createTestApp()

    const res = await app.request("/runtime/instruct-runs/nonexistent/cancel", {
      method: "POST",
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe("RUN_NOT_FOUND")
  })

  test("GET /runtime/instruct-runs/:runId/events returns SSE stream", async () => {
    const app = createTestApp()

    // Create a run first
    const createRes = await app.request("/runtime/instruct-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: "conv-4",
        userMessage: { role: "user", content: "Test" },
        history: [],
      }),
    })
    const created = await createRes.json()

    const res = await app.request(`/runtime/instruct-runs/${created.runId}/events`)
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("text/event-stream")

    // Read the SSE stream body
    const text = await res.text()
    // Should contain at least the run.started event
    expect(text).toContain("event: run.started")
  })

  test("GET /runtime/instruct-runs/:runId/events unknown run returns 404", async () => {
    const app = createTestApp()

    const res = await app.request("/runtime/instruct-runs/nonexistent/events")
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe("RUN_NOT_FOUND")
  })

  test("POST question answer with invalid input returns 400", async () => {
    const app = createTestApp()

    const createRes = await app.request("/runtime/instruct-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: "conv-5",
        userMessage: { role: "user", content: "Test" },
        history: [],
      }),
    })
    const created = await createRes.json()

    const res = await app.request(
      `/runtime/instruct-runs/${created.runId}/questions/req-1/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invalid: true }),
      }
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe("QUESTION_INVALID_INPUT")
  })

  test("POST question answer unknown run returns 404", async () => {
    const app = createTestApp()

    const res = await app.request(
      "/runtime/instruct-runs/nonexistent/questions/req-1/answer",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: [{ questionId: "q1", answer: "test" }] }),
      }
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe("QUESTION_NOT_FOUND")
  })

  test("POST with draft creates run successfully", async () => {
    const app = createTestApp()

    const res = await app.request("/runtime/instruct-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: "conv-6",
        userMessage: {
          role: "user",
          content: "Create an agent with this draft",
        },
        history: [],
        draft: {
          name: "My Draft Agent",
          description: "Draft description",
          systemPrompt: "You are helpful",
          capabilities: ["code-review"],
          allowedTools: ["ls", "read_file"],
          permissionPolicy: {
            filesystem: "read",
          },
        },
      }),
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.runId).toBeTruthy()
    expect(body.agentId).toBe("instruct-agent")
  })
})
