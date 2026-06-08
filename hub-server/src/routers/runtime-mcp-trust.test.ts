import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import { errorHandler } from "../lib/errors"
import type { RuntimeClient } from "../lib/runtime"
import type { ConversationService } from "../services/conversation.service"
import runtimeMcpTrust from "./runtime-mcp-trust"

function createApp(options: {
  runtimeClient: Partial<RuntimeClient>
  conversationService?: Partial<ConversationService>
}): Hono {
  const app = new Hono()
  app.onError(errorHandler)
  app.use("*", async (c: Context, next: Next) => {
    c.set("runtimeClient", options.runtimeClient as RuntimeClient)
    c.set("conversationService", options.conversationService as ConversationService)
    await next()
  })
  app.route("/", runtimeMcpTrust)
  return app
}

function conversationWithWorkspace(): Awaited<ReturnType<ConversationService["getConversationDetail"]>> {
  return {
    id: "conv_1",
    title: "Test",
    mode: "single",
    status: "active",
    orchestratorAgentId: null,
    lastMessageId: null,
    lastMessageAt: null,
    pinnedAt: null,
    archivedAt: null,
    metadata: {
      workspace: {
        workspaceId: "workspace_1",
        backendType: "local",
        rootPath: "D:\\Workspace\\Project",
      },
    },
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    agents: [],
  }
}

describe("runtime MCP trust router", () => {
  test("forwards global MCP trust query and decision without requiring a conversation", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const app = createApp({
      runtimeClient: {
        forward: async (method: string, path: string, body: unknown) => {
          calls.push({ method, path, body })
          if (method === "POST") {
            return {
              status: 200,
              data: {
                checkedAt: "2026-06-08T00:00:00.000Z",
                scope: "global",
                trusts: [{
                  scope: "global",
                  level: "global",
                  mcpRef: "global:codex:config.toml:filesystem",
                  trusted: true,
                  status: "trusted",
                  createdAt: "2026-06-08T00:00:00.000Z",
                  updatedAt: "2026-06-08T00:00:00.000Z",
                }],
              },
            }
          }
          return {
            status: 200,
            data: {
              record: {
                scope: "global",
                level: "global",
                mcpRef: "global:codex:config.toml:filesystem",
                trusted: false,
                status: "untrusted",
                createdAt: "2026-06-08T00:00:00.000Z",
                updatedAt: "2026-06-08T00:00:00.000Z",
              },
            },
          }
        },
      },
    })

    const query = await app.request("/api/runtime/mcp-trust/query", {
      method: "POST",
      body: JSON.stringify({
        scope: "global",
        mcpRefs: ["global:codex:config.toml:filesystem"],
      }),
      headers: { "Content-Type": "application/json" },
    })
    const decision = await app.request("/api/runtime/mcp-trust", {
      method: "PUT",
      body: JSON.stringify({
        scope: "global",
        mcpRef: "global:codex:config.toml:filesystem",
        trusted: false,
        reason: "revoked in plugin config",
      }),
      headers: { "Content-Type": "application/json" },
    })

    expect(query.status).toBe(200)
    expect(decision.status).toBe(200)
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/runtime/mcp-trust/query",
        body: {
          scope: "global",
          mcpRefs: ["global:codex:config.toml:filesystem"],
        },
      },
      {
        method: "PUT",
        path: "/runtime/mcp-trust",
        body: {
          scope: "global",
          mcpRef: "global:codex:config.toml:filesystem",
          trusted: false,
          reason: "revoked in plugin config",
        },
      },
    ])
  })

  test("resolves workspace snapshot before forwarding MCP trust query and decision", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const app = createApp({
      runtimeClient: {
        forward: async (method: string, path: string, body: unknown) => {
          calls.push({ method, path, body })
          if (method === "POST") {
            return {
              status: 200,
              data: {
                checkedAt: "2026-06-08T00:00:00.000Z",
                scope: "workspace",
                workspace: {
                  workspaceId: "workspace_1",
                  backendType: "local",
                  workspaceRootHash: "hash",
                },
                trusts: [],
              },
            }
          }
          return {
            status: 200,
            data: {
              record: {
                scope: "workspace",
                level: "workspace",
                workspaceId: "workspace_1",
                backendType: "local",
                workspaceRootHash: "hash",
                mcpRef: "workspace:agents:mcp.json:filesystem",
                trusted: true,
                status: "trusted",
                createdAt: "2026-06-08T00:00:00.000Z",
                updatedAt: "2026-06-08T00:00:00.000Z",
              },
            },
          }
        },
      },
      conversationService: {
        getConversationDetail: async () => conversationWithWorkspace(),
      },
    })

    const query = await app.request("/api/runtime/mcp-trust/query", {
      method: "POST",
      body: JSON.stringify({
        scope: "workspace",
        conversationId: "conv_1",
        mcpRefs: ["workspace:agents:mcp.json:filesystem"],
      }),
      headers: { "Content-Type": "application/json" },
    })
    const decision = await app.request("/api/runtime/mcp-trust", {
      method: "PUT",
      body: JSON.stringify({
        scope: "workspace",
        conversationId: "conv_1",
        mcpRef: "workspace:agents:mcp.json:filesystem",
        trusted: true,
        reason: "approved in plugin config",
      }),
      headers: { "Content-Type": "application/json" },
    })

    expect(query.status).toBe(200)
    expect(decision.status).toBe(200)
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/runtime/mcp-trust/query",
        body: {
          scope: "workspace",
          workspace: {
            workspaceId: "workspace_1",
            backendType: "local",
            rootPath: "D:\\Workspace\\Project",
          },
          mcpRefs: ["workspace:agents:mcp.json:filesystem"],
        },
      },
      {
        method: "PUT",
        path: "/runtime/mcp-trust",
        body: {
          scope: "workspace",
          workspace: {
            workspaceId: "workspace_1",
            backendType: "local",
            rootPath: "D:\\Workspace\\Project",
          },
          mcpRef: "workspace:agents:mcp.json:filesystem",
          trusted: true,
          reason: "approved in plugin config",
        },
      },
    ])
  })

  test("rejects browser supplied workspace data and unresolved workspaces", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const app = createApp({
      runtimeClient: {
        forward: async (method: string, path: string, body: unknown) => {
          calls.push({ method, path, body })
          return { status: 200, data: {} }
        },
      },
      conversationService: {
        getConversationDetail: async () => ({
          ...conversationWithWorkspace(),
          metadata: {},
        }),
      },
    })

    const invalidInput = await app.request("/api/runtime/mcp-trust/query", {
      method: "POST",
      body: JSON.stringify({
        scope: "workspace",
        conversationId: "conv_1",
        workspace: { rootPath: "D:\\ShouldNotBeAccepted" },
      }),
      headers: { "Content-Type": "application/json" },
    })
    expect(invalidInput.status).toBe(400)
    await expect(invalidInput.json()).resolves.toMatchObject({
      error: { code: "MCP_TRUST_INVALID_INPUT" },
    })

    const unresolved = await app.request("/api/runtime/mcp-trust/query", {
      method: "POST",
      body: JSON.stringify({
        scope: "workspace",
        conversationId: "conv_1",
        mcpRefs: ["workspace:agents:mcp.json:filesystem"],
      }),
      headers: { "Content-Type": "application/json" },
    })
    expect(unresolved.status).toBe(400)
    await expect(unresolved.json()).resolves.toMatchObject({
      error: { code: "WORKSPACE_NOT_RESOLVED" },
    })
    expect(calls).toEqual([])
  })

  test("passes through stable Runtime MCP trust errors", async () => {
    const app = createApp({
      runtimeClient: {
        forward: async () => ({
          status: 400,
          data: {
            error: {
              code: "MCP_TRUST_REF_INVALID",
              message: "MCP ref must be a valid capability discovery MCP id.",
            },
          },
        }),
      },
    })

    const response = await app.request("/api/runtime/mcp-trust", {
      method: "PUT",
      body: JSON.stringify({
        scope: "global",
        mcpRef: "global codex invalid",
        trusted: true,
      }),
      headers: { "Content-Type": "application/json" },
    })
    const body = await response.json() as { error: { code: string } }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("MCP_TRUST_REF_INVALID")
  })
})
