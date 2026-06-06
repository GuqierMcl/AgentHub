import { describe, expect, it } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import systemRouter from "./system"
import { AppError, errorHandler } from "../lib/errors"
import type { RuntimeClient } from "../lib/runtime"

function createApp(runtimeClient: Partial<RuntimeClient>): Hono {
  const app = new Hono()
  app.onError(errorHandler)
  app.use("*", async (c: Context, next: Next) => {
    c.set("runtimeClient", runtimeClient as RuntimeClient)
    await next()
  })
  app.route("/", systemRouter)
  return app
}

describe("system router", () => {
  it("aggregates Agent Runtime health with runtime-managed external services", async () => {
    const calls: Array<[string, string]> = []
    const app = createApp({
      forward: async (method: string, path: string) => {
        calls.push([method, path])
        if (path === "/health") {
          return { status: 200, data: { status: "ok" } }
        }
        if (path === "/runtime/services/status") {
          return {
            status: 200,
            data: {
              checkedAt: "2026-06-03T00:00:00.000Z",
              services: [{
                id: "opencode",
                label: "OpenCode",
                kind: "external-agent",
                status: "idle",
                implemented: true,
                checkedAt: "2026-06-03T00:00:00.000Z",
                activeWorkspaceCount: 0,
                pendingWorkspaceCount: 0,
              }, {
                id: "codex",
                label: "Codex",
                kind: "external-agent",
                status: "idle",
                implemented: true,
                checkedAt: "2026-06-03T00:00:00.000Z",
              }],
            },
          }
        }
        throw new Error(`unexpected path ${path}`)
      },
    })

    const response = await app.request("/api/system/services/status")
    const body = await response.json() as {
      services: Array<{ id: string; status: string; implemented: boolean }>
    }

    expect(response.status).toBe(200)
    expect(body.services.map((service) => service.id)).toEqual([
      "agent-runtime",
      "opencode",
      "codex",
      "claude-code",
    ])
    expect(body.services[0]).toMatchObject({
      id: "agent-runtime",
      label: "AgentRuntime",
      status: "running",
      implemented: true,
    })
    expect(body.services.find((service) => service.id === "opencode")).toMatchObject({
      status: "idle",
      implemented: true,
    })
    expect(body.services.find((service) => service.id === "codex")).toMatchObject({
      status: "idle",
      implemented: true,
    })
    expect(body.services.find((service) => service.id === "claude-code")).toMatchObject({
      status: "error",
      implemented: true,
    })
    expect(calls).toEqual([
      ["GET", "/health"],
      ["GET", "/runtime/services/status"],
    ])
  })

  it("returns a degraded status response when Agent Runtime is unavailable", async () => {
    const app = createApp({
      forward: async () => {
        throw new AppError(503 as never, "RUNTIME_NOT_READY", "Agent Runtime is not available")
      },
    })

    const response = await app.request("/api/system/services/status")
    const body = await response.json() as {
      services: Array<{ id: string; status: string; implemented: boolean }>
    }

    expect(response.status).toBe(200)
    expect(body.services.find((service) => service.id === "agent-runtime")).toMatchObject({
      status: "error",
      implemented: true,
    })
    expect(body.services.find((service) => service.id === "opencode")).toMatchObject({
      status: "error",
      implemented: true,
    })
    expect(body.services.find((service) => service.id === "codex")).toMatchObject({
      status: "error",
      implemented: true,
    })
    expect(body.services.find((service) => service.id === "claude-code")).toMatchObject({
      status: "error",
      implemented: true,
    })
  })
})
