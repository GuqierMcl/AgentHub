import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { McpTrustService } from "../src/runtime"
import { mcpTrustRouter } from "../src/routers/mcp-trust"

async function createApp(): Promise<Hono> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-mcp-trust-router-"))
  const service = new McpTrustService({ dataDir })
  await service.initialize()

  const app = new Hono()
  app.use("*", async (c: Context, next: Next) => {
    c.set("mcpTrustService", service)
    await next()
  })
  app.route("/", mcpTrustRouter)
  return app
}

const workspace = {
  workspaceId: "workspace_router",
  backendType: "local" as const,
  rootPath: "D:\\Projects\\Router",
}

describe("MCP trust router", () => {
  test("records and queries global MCP trust decisions", async () => {
    const app = await createApp()

    const decision = await app.request("/runtime/mcp-trust", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "global",
        mcpRef: "global:codex:config.toml:filesystem",
        trusted: false,
        reason: "revoked in UI",
      }),
    })

    expect(decision.status).toBe(200)
    const decisionBody = await decision.json()
    expect(decisionBody.record).toMatchObject({
      scope: "global",
      level: "global",
      mcpRef: "global:codex:config.toml:filesystem",
      trusted: false,
      status: "untrusted",
    })

    const query = await app.request("/runtime/mcp-trust/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "global",
        mcpRefs: [
          "global:codex:config.toml:filesystem",
          "global:codex:config.toml:missing",
        ],
      }),
    })

    expect(query.status).toBe(200)
    const queryBody = await query.json()
    expect(queryBody.trusts).toHaveLength(2)
    expect(queryBody.trusts).toContainEqual(expect.objectContaining({
      mcpRef: "global:codex:config.toml:filesystem",
      trusted: false,
      status: "untrusted",
    }))
    expect(queryBody.trusts).toContainEqual(expect.objectContaining({
      mcpRef: "global:codex:config.toml:missing",
      trusted: true,
      status: "trusted",
    }))
  })

  test("records workspace MCP trust decisions without exposing rootPath", async () => {
    const app = await createApp()

    const decision = await app.request("/runtime/mcp-trust", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "workspace",
        workspace,
        mcpRef: "workspace:agents:mcp.json:filesystem",
        trusted: true,
      }),
    })

    expect(decision.status).toBe(200)
    const decisionBody = await decision.json()
    expect(decisionBody.record).toMatchObject({
      scope: "workspace",
      level: "workspace",
      workspaceId: "workspace_router",
      backendType: "local",
      workspaceRootHash: expect.any(String),
      mcpRef: "workspace:agents:mcp.json:filesystem",
      trusted: true,
      status: "trusted",
    })
    expect(JSON.stringify(decisionBody)).not.toContain("D:\\Projects\\Router")
  })

  test("returns stable error codes for invalid requests", async () => {
    const app = await createApp()

    const invalidJson = await app.request("/runtime/mcp-trust/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    })
    expect(invalidJson.status).toBe(400)
    await expect(invalidJson.json()).resolves.toMatchObject({
      error: { code: "MCP_TRUST_INVALID_INPUT" },
    })

    const missingWorkspace = await app.request("/runtime/mcp-trust/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "workspace",
        mcpRefs: ["workspace:agents:mcp.json:filesystem"],
      }),
    })
    expect(missingWorkspace.status).toBe(400)
    await expect(missingWorkspace.json()).resolves.toMatchObject({
      error: { code: "MCP_TRUST_WORKSPACE_REQUIRED" },
    })

    const invalidRef = await app.request("/runtime/mcp-trust", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "global",
        mcpRef: "global codex config",
        trusted: true,
      }),
    })
    expect(invalidRef.status).toBe(400)
    const invalidRefBody = await invalidRef.json()
    expect(invalidRefBody).toMatchObject({
      error: { code: "MCP_TRUST_REF_INVALID" },
    })
    expect(JSON.stringify(invalidRefBody)).not.toContain("D:\\Projects\\Router")
  })
})
