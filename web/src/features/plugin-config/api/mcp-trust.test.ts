import { afterEach, describe, expect, test } from "bun:test"

import { mcpTrustApi } from "./mcp-trust"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("mcpTrustApi", () => {
  test("queries workspace MCP trust records through HubServer without sending rootPath", async () => {
    const calls: Array<{ path: string; init?: RequestInit; body: unknown }> = []
    globalThis.fetch = ((path: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as unknown
      calls.push({ path: String(path), init, body })
      return Promise.resolve(new Response(JSON.stringify({
        checkedAt: "2026-06-08T00:00:00.000Z",
        scope: "workspace",
        workspace: {
          workspaceId: "workspace_1",
          backendType: "local",
          workspaceRootHash: "hash",
        },
        trusts: [],
      }), { status: 200 }))
    }) as typeof fetch

    await mcpTrustApi.query("conv_1", ["workspace:agents:mcp.json:filesystem"])

    expect(calls).toEqual([{
      path: "/api/runtime/mcp-trust/query",
      init: expect.objectContaining({ method: "POST" }),
      body: {
        scope: "workspace",
        conversationId: "conv_1",
        mcpRefs: ["workspace:agents:mcp.json:filesystem"],
      },
    }])
    expect(JSON.stringify(calls)).not.toContain("rootPath")
    expect(JSON.stringify(calls)).not.toContain("\"workspace\":")
  })

  test("persists workspace MCP trust decisions through HubServer without sending rootPath", async () => {
    const calls: Array<{ path: string; init?: RequestInit; body: unknown }> = []
    globalThis.fetch = ((path: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as unknown
      calls.push({ path: String(path), init, body })
      return Promise.resolve(new Response(JSON.stringify({
        record: {
          scope: "workspace",
          level: "workspace",
          workspaceId: "workspace_1",
          backendType: "local",
          workspaceRootHash: "hash",
          mcpRef: "workspace:agents:mcp.json:filesystem",
          trusted: false,
          status: "untrusted",
          createdAt: "2026-06-08T00:00:00.000Z",
          updatedAt: "2026-06-08T00:00:00.000Z",
        },
      }), { status: 200 }))
    }) as typeof fetch

    await mcpTrustApi.decide({
      conversationId: "conv_1",
      mcpRef: "workspace:agents:mcp.json:filesystem",
      trusted: false,
      reason: "revoked in plugin config",
    })

    expect(calls).toEqual([{
      path: "/api/runtime/mcp-trust",
      init: expect.objectContaining({ method: "PUT" }),
      body: {
        scope: "workspace",
        conversationId: "conv_1",
        mcpRef: "workspace:agents:mcp.json:filesystem",
        trusted: false,
        reason: "revoked in plugin config",
      },
    }])
    expect(JSON.stringify(calls)).not.toContain("rootPath")
    expect(JSON.stringify(calls)).not.toContain("\"workspace\":")
  })
})
