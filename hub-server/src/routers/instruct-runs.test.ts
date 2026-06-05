import { describe, expect, it } from "bun:test"
import { Hono, type Context, type Next } from "hono"

import instructRunsRouter, { createInstructRunsRouter } from "./instruct-runs"
import type { RuntimeClient } from "../lib/runtime"

type PromptSnapshot = {
  prompt: string | null
  updatedAt: string | null
}

function createApp(options?: {
  promptService?: {
    get: () => PromptSnapshot
    save: (prompt: string) => PromptSnapshot
  }
  runtimeClient?: Partial<RuntimeClient>
}): Hono {
  const app = new Hono()
  app.use("*", async (c: Context, next: Next) => {
    c.set("runtimeClient", (options?.runtimeClient ?? {}) as RuntimeClient)
    await next()
  })
  app.route(
    "/",
    options?.promptService
      ? createInstructRunsRouter({ promptService: options.promptService })
      : instructRunsRouter
  )
  return app
}

describe("instruct runs router", () => {
  it("returns last prompt snapshot", async () => {
    const app = createApp({
      promptService: {
        get: () => ({
          prompt: "create an agent",
          updatedAt: "2026-06-05T12:00:00.000Z",
        }),
        save: () => ({
          prompt: "create an agent",
          updatedAt: "2026-06-05T12:00:00.000Z",
        }),
      },
    })

    const response = await app.request("/api/instruct-runs/last-prompt")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      prompt: "create an agent",
      updatedAt: "2026-06-05T12:00:00.000Z",
    })
  })

  it("proxies instruct run creation and saves prompt", async () => {
    const saves: string[] = []
    const calls: Array<[string, string, unknown]> = []
    const app = createApp({
      promptService: {
        get: () => ({ prompt: null, updatedAt: null }),
        save: (prompt) => {
          saves.push(prompt)
          return {
            prompt,
            updatedAt: "2026-06-05T12:00:00.000Z",
          }
        },
      },
      runtimeClient: {
        forward: async (method: string, path: string, body?: unknown) => {
          calls.push([method, path, body])
          return {
            status: 201,
            data: {
              runId: "instruct_run_1",
              status: "queued",
              agentId: "instruct-agent",
              eventsUrl: "/runtime/instruct-runs/instruct_run_1/events",
            },
          }
        },
      },
    })

    const payload = {
      conversationId: "instruct-session-1",
      userMessage: {
        role: "user",
        content: "  create a code review agent  ",
      },
    }
    const response = await app.request("/api/instruct-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      runId: "instruct_run_1",
      status: "queued",
      agentId: "instruct-agent",
      eventsUrl: "/runtime/instruct-runs/instruct_run_1/events",
    })
    expect(saves).toEqual(["create a code review agent"])
    expect(calls).toEqual([["POST", "/runtime/instruct-runs", payload]])
  })

  it("validates instruct run creation input", async () => {
    const app = createApp({
      promptService: {
        get: () => ({ prompt: null, updatedAt: null }),
        save: () => ({ prompt: null, updatedAt: null }),
      },
    })

    const response = await app.request("/api/instruct-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: "",
        userMessage: {
          role: "user",
          content: "",
        },
      }),
    })
    const body = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(400)
    expect(body.error?.code).toBe("INSTRUCT_RUN_INVALID_INPUT")
  })

  it("proxies question answers to runtime", async () => {
    const calls: Array<[string, string, unknown]> = []
    const app = createApp({
      promptService: {
        get: () => ({ prompt: null, updatedAt: null }),
        save: () => ({ prompt: null, updatedAt: null }),
      },
      runtimeClient: {
        forward: async (method: string, path: string, body?: unknown) => {
          calls.push([method, path, body])
          return {
            status: 200,
            data: {
              requestId: "request_1",
              status: "answered",
            },
          }
        },
      },
    })

    const response = await app.request(
      "/api/instruct-runs/instruct_run_1/questions/request_1/answer",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answers: [{ questionId: "question_1", optionId: "option_1" }],
        }),
      }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      requestId: "request_1",
      status: "answered",
    })
    expect(calls).toEqual([[
      "POST",
      "/runtime/instruct-runs/instruct_run_1/questions/request_1/answer",
      { answers: [{ questionId: "question_1", optionId: "option_1" }] },
    ]])
  })

  it("validates question answer input", async () => {
    const app = createApp({
      promptService: {
        get: () => ({ prompt: null, updatedAt: null }),
        save: () => ({ prompt: null, updatedAt: null }),
      },
    })

    const response = await app.request(
      "/api/instruct-runs/instruct_run_1/questions/request_1/answer",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: [] }),
      }
    )
    const body = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(400)
    expect(body.error?.code).toBe("QUESTION_INVALID_INPUT")
  })

  it("streams runtime instruct events directly", async () => {
    let requestedPath = ""
    const app = createApp({
      promptService: {
        get: () => ({ prompt: null, updatedAt: null }),
        save: () => ({ prompt: null, updatedAt: null }),
      },
      runtimeClient: {
        stream: async (path: string) => {
          requestedPath = path
          return new Response(
            'event: run.event\ndata: {"event":{"type":"run.started"}}\n\n',
            {
              status: 200,
              headers: { "Content-Type": "text/event-stream" },
            }
          )
        },
      },
    })

    const response = await app.request("/api/instruct-runs/instruct_run_1/events")
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(requestedPath).toBe("/runtime/instruct-runs/instruct_run_1/events")
    expect(text).toContain('event: run.event')
  })
})
