import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import { mcpRuntimeRouter } from "../src/routers/mcp-runtime"
import type { McpWorkspaceStatusResponse } from "../src/runtime"

function createApp(service: {
  ensureWorkspaceStatus(input: unknown): Promise<McpWorkspaceStatusResponse>
}): Hono {
  const app = new Hono()
  app.use("*", async (c: Context, next: Next) => {
    c.set("mcpRuntimeService", service)
    await next()
  })
  app.route("/", mcpRuntimeRouter)
  return app
}

const workspace = {
  workspaceId: "workspace_router",
  backendType: "local" as const,
  rootPath: "D:\\Projects\\Router",
}

function statusResponse(): McpWorkspaceStatusResponse {
  return {
    checkedAt: "2026-06-08T00:00:00.000Z",
    workspace: {
      workspaceId: workspace.workspaceId,
      backendType: "local",
      workspaceRootHash: "hash_123",
    },
    summary: {
      serverCount: 1,
      enabledCount: 1,
      connectedCount: 1,
      errorCount: 0,
      toolCount: 2,
    },
    servers: [
      {
        id: "workspace:opencode:opencode.json:docs",
        name: "docs",
        source: "opencode",
        transport: "stdio",
        status: "connected",
        enabled: true,
        trusted: true,
        toolCount: 2,
      },
    ],
  }
}

describe("MCP runtime router", () => {
  test("POST /runtime/mcp/workspace/status connects by default and returns redacted status", async () => {
    const calls: unknown[] = []
    const app = createApp({
      async ensureWorkspaceStatus(input) {
        calls.push(input)
        return statusResponse()
      },
    })

    const response = await app.request("/runtime/mcp/workspace/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace }),
    })

    expect(response.status).toBe(200)
    expect(calls).toEqual([{ workspace, connect: true }])
    const body = await response.json()
    expect(body).toMatchObject({
      summary: {
        enabledCount: 1,
        connectedCount: 1,
        toolCount: 2,
      },
      servers: [
        {
          name: "docs",
          status: "connected",
          enabled: true,
          trusted: true,
        },
      ],
    })
    expect(JSON.stringify(body)).not.toContain("D:\\Projects\\Router")
  })

  test("supports connect=false for no-side-effect snapshots", async () => {
    const calls: unknown[] = []
    const app = createApp({
      async ensureWorkspaceStatus(input) {
        calls.push(input)
        return statusResponse()
      },
    })

    const response = await app.request("/runtime/mcp/workspace/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace, connect: false }),
    })

    expect(response.status).toBe(200)
    expect(calls).toEqual([{ workspace, connect: false }])
  })

  test("returns stable error codes for invalid requests", async () => {
    const app = createApp({
      async ensureWorkspaceStatus() {
        throw new Error("should not be called")
      },
    })

    const invalidJson = await app.request("/runtime/mcp/workspace/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    })
    expect(invalidJson.status).toBe(400)
    await expect(invalidJson.json()).resolves.toMatchObject({
      error: { code: "MCP_RUNTIME_INVALID_INPUT" },
    })

    const missingWorkspace = await app.request("/runtime/mcp/workspace/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connect: true }),
    })
    expect(missingWorkspace.status).toBe(400)
    await expect(missingWorkspace.json()).resolves.toMatchObject({
      error: { code: "MCP_RUNTIME_WORKSPACE_REQUIRED" },
    })
  })
})
