import { afterEach, describe, expect, it } from "bun:test"
import { RuntimeClient } from "./runtime"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("RuntimeClient", () => {
  it("adds the internal token header to forwarded Runtime requests", async () => {
    const calls: RequestInit[] = []
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {})
      return Response.json({ ok: true })
    }) as typeof fetch

    const client = new RuntimeClient("http://127.0.0.1:4096", { token: "secret" })

    await client.forward("GET", "/runtime/services/status")

    expect(calls[0].headers).toMatchObject({
      "x-agenthub-runtime-token": "secret",
    })
  })

  it("does not add the internal token header when no token is configured", async () => {
    const calls: RequestInit[] = []
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {})
      return Response.json({ ok: true })
    }) as typeof fetch

    const client = new RuntimeClient("http://127.0.0.1:4096")

    await client.forward("GET", "/runtime/services/status")

    expect(calls[0].headers).not.toHaveProperty("x-agenthub-runtime-token")
  })

  it("can update the Runtime base URL after a sidecar restart", async () => {
    const urls: string[] = []
    globalThis.fetch = (async (url: string | URL | Request) => {
      urls.push(String(url))
      return Response.json({ ok: true })
    }) as typeof fetch

    const client = new RuntimeClient("http://127.0.0.1:4096")
    client.setBaseUrl("http://127.0.0.1:4123")

    await client.forward("GET", "/health")

    expect(urls[0]).toBe("http://127.0.0.1:4123/health")
  })
})
