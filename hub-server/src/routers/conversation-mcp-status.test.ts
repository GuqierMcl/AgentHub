import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import { errorHandler } from "../lib/errors"
import type { RuntimeClient } from "../lib/runtime"
import type { ConversationService } from "../services/conversation.service"
import conversationMcpStatus from "./conversation-mcp-status"

function createApp(options: {
  runtimeClient: Partial<RuntimeClient>
  conversationService: Partial<ConversationService>
}): Hono {
  const app = new Hono()
  app.onError(errorHandler)
  app.use("*", async (c: Context, next: Next) => {
    c.set("runtimeClient", options.runtimeClient as RuntimeClient)
    c.set("conversationService", options.conversationService as ConversationService)
    await next()
  })
  app.route("/", conversationMcpStatus)
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

describe("conversation MCP status router", () => {
  test("resolves conversation workspace and forwards Runtime MCP status request", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const app = createApp({
      runtimeClient: {
        forward: async (method: string, path: string, body: unknown) => {
          calls.push({ method, path, body })
          return {
            status: 200,
            data: {
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
            },
          }
        },
      },
      conversationService: {
        getConversationDetail: async () => conversationWithWorkspace(),
      },
    })

    const response = await app.request("/api/conversations/conv_1/mcp/status")
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.summary).toMatchObject({
      connectedCount: 1,
      toolCount: 2,
    })
    expect(calls).toEqual([{
      method: "POST",
      path: "/runtime/mcp/workspace/status",
      body: {
        workspace: {
          workspaceId: "workspace_1",
          backendType: "local",
          rootPath: "D:\\Workspace\\Project",
        },
        connect: true,
      },
    }])
    expect(JSON.stringify(body)).not.toContain("D:\\Workspace\\Project")
  })

  test("returns WORKSPACE_NOT_RESOLVED without calling Runtime when conversation has no workspace", async () => {
    const calls: unknown[] = []
    const app = createApp({
      runtimeClient: {
        forward: async () => {
          calls.push("called")
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

    const response = await app.request("/api/conversations/conv_1/mcp/status")

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "WORKSPACE_NOT_RESOLVED" },
    })
    expect(calls).toEqual([])
  })

  test("passes through Runtime MCP status errors without exposing Runtime URL", async () => {
    const app = createApp({
      runtimeClient: {
        forward: async () => ({
          status: 500,
          data: {
            error: {
              code: "MCP_RUNTIME_CONNECT_FAILED",
              message: "MCP server config is not connectable.",
            },
          },
        }),
      },
      conversationService: {
        getConversationDetail: async () => conversationWithWorkspace(),
      },
    })

    const response = await app.request("/api/conversations/conv_1/mcp/status")
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toMatchObject({
      error: {
        code: "MCP_RUNTIME_CONNECT_FAILED",
      },
    })
    expect(JSON.stringify(body)).not.toContain("127.0.0.1")
    expect(JSON.stringify(body)).not.toContain("localhost")
  })
})
