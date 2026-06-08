import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import { errorHandler } from "../lib/errors"
import type { RuntimeClient } from "../lib/runtime"
import type { ConversationService } from "../services/conversation.service"
import runtimeWorkspaceSkillTrust from "./runtime-workspace-skill-trust"

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
  app.route("/", runtimeWorkspaceSkillTrust)
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

describe("runtime workspace Skill trust router", () => {
  test("resolves workspace snapshot before forwarding trust query", async () => {
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
              trusts: [],
            },
          }
        },
      },
      conversationService: {
        getConversationDetail: async () => conversationWithWorkspace(),
      },
    })

    const response = await app.request("/api/runtime/workspace-skill-trust/query", {
      method: "POST",
      body: JSON.stringify({
        conversationId: "conv_1",
        skillRefs: ["workspace:agents:review"],
      }),
      headers: { "Content-Type": "application/json" },
    })

    expect(response.status).toBe(200)
    expect(calls).toEqual([{
      method: "POST",
      path: "/runtime/workspace-skill-trust/query",
      body: {
        workspace: {
          workspaceId: "workspace_1",
          backendType: "local",
          rootPath: "D:\\Workspace\\Project",
        },
        skillRefs: ["workspace:agents:review"],
      },
    }])
  })

  test("resolves workspace snapshot before forwarding trust decision", async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const app = createApp({
      runtimeClient: {
        forward: async (method: string, path: string, body: unknown) => {
          calls.push({ method, path, body })
          return {
            status: 200,
            data: {
              record: {
                workspaceId: "workspace_1",
                backendType: "local",
                workspaceRootHash: "hash",
                skillRef: "workspace:agents:review",
                source: "agents",
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

    const response = await app.request("/api/runtime/workspace-skill-trust", {
      method: "PUT",
      body: JSON.stringify({
        conversationId: "conv_1",
        skillRef: "workspace:agents:review",
        trusted: true,
        reason: "approved in UI",
      }),
      headers: { "Content-Type": "application/json" },
    })

    expect(response.status).toBe(200)
    expect(calls).toEqual([{
      method: "PUT",
      path: "/runtime/workspace-skill-trust",
      body: {
        workspace: {
          workspaceId: "workspace_1",
          backendType: "local",
          rootPath: "D:\\Workspace\\Project",
        },
        skillRef: "workspace:agents:review",
        trusted: true,
        reason: "approved in UI",
      },
    }])
  })

  test("rejects browser supplied rootPath and unresolved workspaces", async () => {
    const app = createApp({
      runtimeClient: {},
      conversationService: {
        getConversationDetail: async () => ({
          ...conversationWithWorkspace(),
          metadata: {},
        }),
      },
    })

    const invalidInput = await app.request("/api/runtime/workspace-skill-trust/query", {
      method: "POST",
      body: JSON.stringify({
        conversationId: "conv_1",
        workspace: { rootPath: "D:\\ShouldNotBeAccepted" },
      }),
      headers: { "Content-Type": "application/json" },
    })
    expect(invalidInput.status).toBe(400)
    await expect(invalidInput.json()).resolves.toMatchObject({
      error: { code: "WORKSPACE_SKILL_TRUST_INVALID_INPUT" },
    })

    const unresolved = await app.request("/api/runtime/workspace-skill-trust/query", {
      method: "POST",
      body: JSON.stringify({
        conversationId: "conv_1",
        skillRefs: ["workspace:agents:review"],
      }),
      headers: { "Content-Type": "application/json" },
    })
    expect(unresolved.status).toBe(400)
    await expect(unresolved.json()).resolves.toMatchObject({
      error: { code: "WORKSPACE_NOT_RESOLVED" },
    })
  })
})
