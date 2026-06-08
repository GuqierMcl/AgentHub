import { afterEach, describe, expect, test } from "bun:test"

import { capabilitiesApi } from "./capabilities"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("capabilitiesApi", () => {
  test("fetches global capabilities as a flat response", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = []
    globalThis.fetch = ((path: string | URL | Request, init?: RequestInit) => {
      calls.push({ path: String(path), init })
      return Promise.resolve(new Response(JSON.stringify({
        discoveredAt: "2026-06-08T00:00:00.000Z",
        scope: "global",
        skills: [],
        mcps: [],
        warnings: [],
      }), { status: 200 }))
    }) as typeof fetch

    await capabilitiesApi.fetchGlobal()

    expect(calls).toEqual([{
      path: "/api/runtime/capabilities?scope=global",
      init: expect.objectContaining({
        headers: { "Content-Type": "application/json" },
      }),
    }])
  })

  test("fetches workspace capabilities as HubServer grouped workspaces", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = []
    globalThis.fetch = ((path: string | URL | Request, init?: RequestInit) => {
      calls.push({ path: String(path), init })
      return Promise.resolve(new Response(JSON.stringify({
        discoveredAt: "2026-06-08T00:00:00.000Z",
        scope: "workspace",
        workspaces: [{
          workspaceKey: "workspace:hash",
          workspaceId: "workspace_1",
          backendType: "local",
          rootPath: "D:\\Projects\\App",
          conversationId: "conv_1",
          conversationIds: ["conv_1"],
          title: "App",
          discoveredAt: "2026-06-08T00:00:00.000Z",
          skills: [],
          mcps: [],
          warnings: [],
        }],
        warnings: [],
      }), { status: 200 }))
    }) as typeof fetch

    const result = await capabilitiesApi.fetchWorkspaceGroups()

    expect(result.workspaces).toHaveLength(1)
    expect(calls).toEqual([{
      path: "/api/runtime/capabilities?scope=workspace",
      init: expect.objectContaining({
        headers: { "Content-Type": "application/json" },
      }),
    }])
    expect(JSON.stringify(calls)).not.toContain("rootPath")
  })

  test("refreshes selected conversation workspace without sending a rootPath", async () => {
    const calls: Array<{ path: string; init?: RequestInit; body: unknown }> = []
    globalThis.fetch = ((path: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as unknown
      calls.push({ path: String(path), init, body })
      return Promise.resolve(new Response(JSON.stringify({
        discoveredAt: "2026-06-08T00:00:00.000Z",
        scope: "workspace",
        workspaces: [],
        warnings: [],
      }), { status: 200 }))
    }) as typeof fetch

    await capabilitiesApi.refreshWorkspaceGroups("conv_1", ["codex"])

    expect(calls).toEqual([{
      path: "/api/runtime/capabilities/refresh",
      init: expect.objectContaining({ method: "POST" }),
      body: {
        scope: "workspace",
        conversationId: "conv_1",
        sources: ["codex"],
      },
    }])
    expect(JSON.stringify(calls)).not.toContain("rootPath")
  })
})
