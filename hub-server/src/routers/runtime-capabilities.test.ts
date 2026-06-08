import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import { errorHandler } from "../lib/errors"
import type { RuntimeClient } from "../lib/runtime"
import type { ConversationService } from "../services/conversation.service"
import type { ConversationDetail, ConversationListItem } from "../domains/conversation/types"
import runtimeCapabilities from "./runtime-capabilities"

type RuntimeCall = {
  method: string
  path: string
  body: unknown
}

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

function conversationListItem(input: {
  id: string
  title: string
  workspaceId?: string
  rootPath?: string
}): ConversationListItem {
  return {
    id: input.id,
    title: input.title,
    mode: "single",
    status: "active",
    orchestratorAgentId: null,
    lastMessageId: null,
    lastMessageAt: null,
    lastMessageContent: "",
    pinnedAt: null,
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
    agents: [],
    metadata: input.rootPath ? {
      workspace: {
        workspaceId: input.workspaceId ?? `workspace_${input.id}`,
        backendType: "local",
        rootPath: input.rootPath,
      },
    } : {},
  }
}

function conversationDetail(input: {
  id: string
  title: string
  workspaceId?: string
  rootPath?: string
}): ConversationDetail {
  return {
    ...conversationListItem(input),
    archivedAt: null,
    agents: [],
  }
}

function capabilityResponse(rootPath: string, workspaceId: string) {
  const name = rootPath.endsWith("Other") ? "other-skill" : "app-skill"
  return {
    discoveredAt: "2026-06-07T00:00:00.000Z",
    scope: "workspace",
    skills: [{
      id: `workspace:${workspaceId}:${name}`,
      name,
      source: "agents",
      level: "workspace",
      path: `workspace:agents:${name}`,
      valid: true,
      warnings: [],
    }],
    mcps: [],
    warnings: [`warning:${workspaceId}`],
    cache: {
      hit: false,
      refreshed: true,
      cacheKey: `workspace:${workspaceId}`,
      expiresAt: "2026-06-07T00:00:30.000Z",
      fingerprint: `fingerprint:${workspaceId}`,
    },
  }
}

describe("runtime capabilities router", () => {
  test("forwards global discovery without requiring a conversation", async () => {
    const calls: RuntimeCall[] = []
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

  test("forwards global refresh without requiring a conversation", async () => {
    const calls: RuntimeCall[] = []
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
              cache: {
                hit: false,
                refreshed: true,
                cacheKey: "scope=global",
                expiresAt: "2026-06-07T00:00:30.000Z",
                fingerprint: "abc123",
              },
            },
          }
        },
      },
    })

    const response = await app.request("/api/runtime/capabilities/refresh", {
      method: "POST",
      body: JSON.stringify({
        scope: "global",
        sources: ["codex"],
      }),
      headers: {
        "Content-Type": "application/json",
      },
    })

    expect(response.status).toBe(200)
    expect(calls).toEqual([{
      method: "POST",
      path: "/runtime/capabilities/refresh",
      body: {
        scope: "global",
        sources: ["codex"],
      },
    }])
  })

  test("rejects all as a browser-facing capability scope", async () => {
    const app = createApp({
      runtimeClient: {},
      conversationService: {},
    })

    const discovery = await app.request("/api/runtime/capabilities?scope=all&conversationId=conv_1")
    const refresh = await app.request("/api/runtime/capabilities/refresh", {
      method: "POST",
      body: JSON.stringify({ scope: "all", conversationId: "conv_1" }),
      headers: { "Content-Type": "application/json" },
    })

    await expect(discovery.json()).resolves.toMatchObject({
      error: { code: "CAPABILITY_INVALID_INPUT" },
    })
    await expect(refresh.json()).resolves.toMatchObject({
      error: { code: "CAPABILITY_INVALID_INPUT" },
    })
    expect(discovery.status).toBe(400)
    expect(refresh.status).toBe(400)
  })

  test("groups active workspace discovery by canonical root path before forwarding to Runtime", async () => {
    const calls: RuntimeCall[] = []
    const app = createApp({
      runtimeClient: {
        forward: async (method: string, path: string, body: unknown) => {
          calls.push({ method, path, body })
          const workspace = (body as { workspace: { rootPath: string; workspaceId: string } }).workspace
          return {
            status: 200,
            data: capabilityResponse(workspace.rootPath, workspace.workspaceId),
          }
        },
      },
      conversationService: {
        listConversations: async () => [
          conversationListItem({
            id: "conv_1",
            title: "App One",
            workspaceId: "workspace_app",
            rootPath: "D:\\Projects\\App",
          }),
          conversationListItem({
            id: "conv_2",
            title: "Same App",
            workspaceId: "workspace_app_duplicate",
            rootPath: "d:\\Projects\\App\\",
          }),
          conversationListItem({
            id: "conv_3",
            title: "Other",
            workspaceId: "workspace_other",
            rootPath: "D:\\Projects\\Other",
          }),
        ],
      },
    })

    const response = await app.request("/api/runtime/capabilities?scope=workspace")
    const body = await response.json() as {
      scope: string
      workspaces: Array<{
        workspaceKey: string
        conversationId: string
        conversationIds: string[]
        title: string
        rootPath: string
        skills: Array<{ name: string }>
        warnings: string[]
      }>
      warnings: string[]
    }

    expect(response.status).toBe(200)
    expect(calls).toHaveLength(2)
    expect(calls.map((call) => call.body)).toEqual([
      {
        scope: "workspace",
        workspace: {
          workspaceId: "workspace_app",
          backendType: "local",
          rootPath: "D:\\Projects\\App",
        },
      },
      {
        scope: "workspace",
        workspace: {
          workspaceId: "workspace_other",
          backendType: "local",
          rootPath: "D:\\Projects\\Other",
        },
      },
    ])
    expect(body.scope).toBe("workspace")
    expect(body.workspaces).toHaveLength(2)
    expect(body.workspaces[0]).toMatchObject({
      conversationId: "conv_1",
      conversationIds: ["conv_1", "conv_2"],
      title: "App",
      rootPath: "D:\\Projects\\App",
      skills: [{ name: "app-skill" }],
      warnings: ["warning:workspace_app"],
    })
    expect(body.workspaces[0].workspaceKey).toStartWith("workspace:")
    expect(body.workspaces[1]).toMatchObject({
      conversationId: "conv_3",
      conversationIds: ["conv_3"],
      title: "Other",
      rootPath: "D:\\Projects\\Other",
      skills: [{ name: "other-skill" }],
    })
  })

  test("filters workspace discovery to the selected conversation root path", async () => {
    const calls: RuntimeCall[] = []
    const app = createApp({
      runtimeClient: {
        forward: async (method: string, path: string, body: unknown) => {
          calls.push({ method, path, body })
          const workspace = (body as { workspace: { rootPath: string; workspaceId: string } }).workspace
          return {
            status: 200,
            data: capabilityResponse(workspace.rootPath, workspace.workspaceId),
          }
        },
      },
      conversationService: {
        getConversationDetail: async () => conversationDetail({
          id: "conv_2",
          title: "Same App",
          workspaceId: "workspace_app_duplicate",
          rootPath: "d:\\Projects\\App\\",
        }),
      },
    })

    const response = await app.request("/api/runtime/capabilities?scope=workspace&conversationId=conv_2")
    const body = await response.json() as {
      workspaces: Array<{ conversationId: string; conversationIds: string[]; rootPath: string }>
    }

    expect(response.status).toBe(200)
    expect(calls.map((call) => call.body)).toEqual([{
      scope: "workspace",
      workspace: {
        workspaceId: "workspace_app_duplicate",
        backendType: "local",
        rootPath: "d:\\Projects\\App\\",
      },
    }])
    expect(body.workspaces).toHaveLength(1)
    expect(body.workspaces[0]).toMatchObject({
      conversationId: "conv_2",
      conversationIds: ["conv_2"],
      rootPath: "d:\\Projects\\App\\",
    })
  })

  test("refreshes each grouped workspace and forwards source filters", async () => {
    const calls: RuntimeCall[] = []
    const app = createApp({
      runtimeClient: {
        forward: async (method: string, path: string, body: unknown) => {
          calls.push({ method, path, body })
          const workspace = (body as { workspace: { rootPath: string; workspaceId: string } }).workspace
          return {
            status: 200,
            data: capabilityResponse(workspace.rootPath, workspace.workspaceId),
          }
        },
      },
      conversationService: {
        listConversations: async () => [
          conversationListItem({
            id: "conv_1",
            title: "App One",
            workspaceId: "workspace_app",
            rootPath: "D:\\Projects\\App",
          }),
          conversationListItem({
            id: "conv_3",
            title: "Other",
            workspaceId: "workspace_other",
            rootPath: "D:\\Projects\\Other",
          }),
        ],
      },
    })

    const response = await app.request("/api/runtime/capabilities/refresh", {
      method: "POST",
      body: JSON.stringify({
        scope: "workspace",
        sources: ["codex", "opencode"],
      }),
      headers: { "Content-Type": "application/json" },
    })
    const body = await response.json() as { workspaces: unknown[] }

    expect(response.status).toBe(200)
    expect(body.workspaces).toHaveLength(2)
    expect(calls.map((call) => call.body)).toEqual([
      {
        scope: "workspace",
        sources: ["codex", "opencode"],
        workspace: {
          workspaceId: "workspace_app",
          backendType: "local",
          rootPath: "D:\\Projects\\App",
        },
      },
      {
        scope: "workspace",
        sources: ["codex", "opencode"],
        workspace: {
          workspaceId: "workspace_other",
          backendType: "local",
          rootPath: "D:\\Projects\\Other",
        },
      },
    ])
  })

  test("does not accept browser supplied workspace snapshots", async () => {
    const calls: RuntimeCall[] = []
    const app = createApp({
      runtimeClient: {
        forward: async (method: string, path: string, body: unknown) => {
          calls.push({ method, path, body })
          return { status: 200, data: {} }
        },
      },
      conversationService: {
        getConversationDetail: async () => conversationDetail({
          id: "conv_1",
          title: "App One",
          workspaceId: "workspace_app",
          rootPath: "D:\\Projects\\App",
        }),
      },
    })

    const response = await app.request("/api/runtime/capabilities/refresh", {
      method: "POST",
      body: JSON.stringify({
        scope: "workspace",
        conversationId: "conv_1",
        workspace: {
          workspaceId: "malicious",
          backendType: "local",
          rootPath: "C:\\Secrets",
        },
      }),
      headers: { "Content-Type": "application/json" },
    })
    const body = await response.json() as { error: { code: string } }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("CAPABILITY_INVALID_INPUT")
    expect(calls).toEqual([])
  })

  test("returns WORKSPACE_NOT_RESOLVED when no active conversation has a workspace root", async () => {
    const app = createApp({
      runtimeClient: {},
      conversationService: {
        listConversations: async () => [
          conversationListItem({ id: "conv_1", title: "No Workspace" }),
        ],
      },
    })

    const response = await app.request("/api/runtime/capabilities?scope=workspace")
    const body = await response.json() as { error: { code: string } }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("WORKSPACE_NOT_RESOLVED")
  })
})
