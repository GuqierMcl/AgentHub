import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import { errorHandler } from "../lib/errors"
import type { RuntimeClient } from "../lib/runtime"
import type { ConversationService } from "../services/conversation.service"
import runtimeCapabilities from "./runtime-capabilities"

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
  app.route("/", runtimeCapabilities)
  return app
}

describe("runtime capabilities router", () => {
  test("forwards global discovery without requiring a conversation", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const app = createApp({
      runtimeClient: {
        forward: async (method: string, path: string, body: unknown) => {
          calls.push({ method, path, body })
          return {
            status: 200,
            data: {
              discoveredAt: "2026-06-07T00:00:00.000Z",
              scope: "global",
              skills: [],
              mcps: [],
              warnings: [],
            },
          }
        },
      },
    })

    const response = await app.request("/api/runtime/capabilities?scope=global")

    expect(response.status).toBe(200)
    expect(calls).toEqual([{
      method: "POST",
      path: "/runtime/capabilities/discover",
      body: { scope: "global" },
    }])
  })

  test("resolves conversation workspace snapshot before forwarding workspace discovery", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const app = createApp({
      runtimeClient: {
        forward: async (method: string, path: string, body: unknown) => {
          calls.push({ method, path, body })
          return {
            status: 200,
            data: {
              discoveredAt: "2026-06-07T00:00:00.000Z",
              scope: "all",
              skills: [],
              mcps: [],
              warnings: [],
            },
          }
        },
      },
      conversationService: {
        getConversationDetail: async () => ({
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
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:00.000Z",
          agents: [],
        }),
      },
    })

    const response = await app.request("/api/runtime/capabilities?scope=all&conversationId=conv_1")

    expect(response.status).toBe(200)
    expect(calls).toEqual([{
      method: "POST",
      path: "/runtime/capabilities/discover",
      body: {
        scope: "all",
        workspace: {
          workspaceId: "workspace_1",
          backendType: "local",
          rootPath: "D:\\Workspace\\Project",
        },
      },
    }])
  })

  test("returns WORKSPACE_NOT_RESOLVED when workspace discovery has no bound workspace", async () => {
    const app = createApp({
      runtimeClient: {},
      conversationService: {
        getConversationDetail: async () => ({
          id: "conv_1",
          title: "Test",
          mode: "single",
          status: "active",
          orchestratorAgentId: null,
          lastMessageId: null,
          lastMessageAt: null,
          pinnedAt: null,
          archivedAt: null,
          metadata: {},
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:00.000Z",
          agents: [],
        }),
      },
    })

    const response = await app.request("/api/runtime/capabilities?scope=workspace&conversationId=conv_1")
    const body = await response.json() as { error: { code: string } }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("WORKSPACE_NOT_RESOLVED")
  })
})
