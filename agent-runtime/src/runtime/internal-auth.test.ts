import { describe, expect, it } from "bun:test"
import { Hono, type Context } from "hono"
import { createRuntimeTokenAuthMiddleware } from "./internal-auth"

function createApp(token?: string): Hono {
  const app = new Hono()
  app.use("*", createRuntimeTokenAuthMiddleware(token))
  app.get("/health", (c: Context) => c.json({ status: "ok" }))
  app.get("/runtime/services/status", (c: Context) => c.json({ status: "ok" }))
  return app
}

describe("createRuntimeTokenAuthMiddleware", () => {
  it("skips validation when no token is configured", async () => {
    const response = await createApp().request("/runtime/services/status")

    expect(response.status).toBe(200)
  })

  it("keeps health checks unauthenticated", async () => {
    const response = await createApp("secret").request("/health")

    expect(response.status).toBe(200)
  })

  it("rejects Runtime API calls without the internal token", async () => {
    const response = await createApp("secret").request("/runtime/services/status")
    const body = await response.json() as { error: { code: string } }

    expect(response.status).toBe(401)
    expect(body.error.code).toBe("RUNTIME_AUTH_REQUIRED")
  })

  it("allows Runtime API calls with the configured internal token", async () => {
    const response = await createApp("secret").request("/runtime/services/status", {
      headers: {
        "x-agenthub-runtime-token": "secret",
      },
    })

    expect(response.status).toBe(200)
  })
})
