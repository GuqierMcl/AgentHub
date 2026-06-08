import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import { errorHandler } from "../lib/errors"
import type { RuntimeClient } from "../lib/runtime"
import type { ConversationService } from "../services/conversation.service"
import agent from "./agent"

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
  app.route("/", agent)
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

describe("agent router Runtime proxy", () => {
  test("proxies external agent settings update to Runtime", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const settings = {
      provider: "claude-code",
      model: "sonnet",
      permissionMode: "plan",
    }
    const runtimeResponse = {
      agentId: "claude-code",
      settings,
      updatedAt: "2026-06-08T00:00:00.000Z",
    }
    const app = createApp({
      runtimeClient: {
        forward: async (method: string, path: string, body: unknown) => {
          calls.push({ method, path, body })
          return { status: 200, data: runtimeResponse }
        },
      },
    })

    const response = await app.request("/api/runtime/agents/claude-code/external-settings", {
      method: "PUT",
      body: JSON.stringify(settings),
      headers: { "Content-Type": "application/json" },
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(runtimeResponse)
    expect(calls).toEqual([{
      method: "PUT",
      path: "/runtime/agents/claude-code/external-settings",
      body: settings,
    }])
  })

  test("proxies external agent settings read to Runtime", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const runtimeResponse = {
      agentId: "codex",
      settings: { provider: "codex", model: "gpt-5-codex" },
      updatedAt: "2026-06-08T00:00:00.000Z",
    }
    const app = createApp({
      runtimeClient: {
        forward: async (method: string, path: string, body: unknown) => {
          calls.push({ method, path, body })
          return { status: 200, data: runtimeResponse }
        },
      },
    })

    const response = await app.request("/api/runtime/agents/codex/external-settings")
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(runtimeResponse)
    expect(calls).toEqual([{
      method: "GET",
      path: "/runtime/agents/codex/external-settings",
      body: undefined,
    }])
  })

  test("rejects browser-supplied OpenCode workspace roots", async () => {
    const calls: unknown[] = []
    const app = createApp({
      runtimeClient: {
        forward: async () => {
          calls.push("called")
          return { status: 200, data: {} }
        },
      },
    })

    const response = await app.request("/api/runtime/agents/opencode/model-catalog", {
      method: "POST",
      body: JSON.stringify({
        workspace: { rootPath: "D:\\secret" },
      }),
      headers: { "Content-Type": "application/json" },
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "OPENCODE_MODEL_CATALOG_INVALID_INPUT" },
    })
    expect(calls).toEqual([])
  })

  test("forwards OpenCode model catalog with conversation workspace snapshot", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const runtimeResponse = {
      models: [{ id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" }],
    }
    const app = createApp({
      runtimeClient: {
        forward: async (method: string, path: string, body: unknown) => {
          calls.push({ method, path, body })
          return { status: 200, data: runtimeResponse }
        },
      },
      conversationService: {
        getConversationDetail: async () => conversationWithWorkspace(),
      },
    })

    const response = await app.request("/api/runtime/agents/opencode/model-catalog", {
      method: "POST",
      body: JSON.stringify({ conversationId: "conv_1" }),
      headers: { "Content-Type": "application/json" },
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(runtimeResponse)
    expect(calls).toEqual([{
      method: "POST",
      path: "/runtime/agents/opencode/model-catalog",
      body: {
        workspace: {
          workspaceId: "workspace_1",
          backendType: "local",
          rootPath: "D:\\Workspace\\Project",
        },
      },
    }])
  })

  test("returns WORKSPACE_NOT_RESOLVED when conversation has no local workspace", async () => {
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

    const response = await app.request("/api/runtime/agents/opencode/model-catalog", {
      method: "POST",
      body: JSON.stringify({ conversationId: "conv_1" }),
      headers: { "Content-Type": "application/json" },
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "WORKSPACE_NOT_RESOLVED" },
    })
    expect(calls).toEqual([])
  })
})
