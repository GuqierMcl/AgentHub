import { afterEach, describe, expect, test } from "bun:test"
import { workspaceMcpStatusApi } from "./workspace-mcp-status"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("workspaceMcpStatusApi", () => {
  test("requests conversation MCP status without sending rootPath or workspace body", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({
        checkedAt: "2026-06-08T00:00:00.000Z",
        workspace: {
          workspaceId: "workspace_1",
          backendType: "local",
          workspaceRootHash: "hash",
        },
        summary: {
          serverCount: 1,
          enabledCount: 1,
          connectedCount: 1,
          errorCount: 0,
          toolCount: 2,
        },
        servers: [{
          id: "workspace:opencode:opencode.json:docs",
          name: "docs",
          source: "opencode",
          transport: "stdio",
          status: "connected",
          enabled: true,
          trusted: true,
          toolCount: 2,
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as typeof fetch

    const response = await workspaceMcpStatusApi.get("conv 1")

    expect(response.summary.toolCount).toBe(2)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      url: "/api/conversations/conv%201/mcp/status",
    })
    expect(calls[0]?.init?.method).toBeUndefined()
    expect(calls[0]?.init?.body).toBeUndefined()
    expect(JSON.stringify(calls[0])).not.toContain("rootPath")
    expect(JSON.stringify(calls[0])).not.toContain("workspace")
  })
})
