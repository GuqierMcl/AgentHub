import { afterEach, describe, expect, test } from "bun:test"
import { Hono, type MiddlewareHandler } from "hono"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import agentsRouter from "./agents"
import { AgentRegistry } from "../agents"
import type { AgentToolAuthoringCatalog } from "../agents"
import type { ProviderService } from "../provider"
import type { RuntimeToolRegistry } from "../runtime"
import type { OpenCodeClient, OpenCodeModelCatalog } from "../runtime/external-adapters/opencode-client"

const tempDirs: string[] = []

const emptyToolCatalog: AgentToolAuthoringCatalog = {
  listUserConfigurableTools: () => [],
}

const providerServiceStub = {
  getProvider: () => null,
  getModel: () => null,
} as unknown as ProviderService

const toolRegistryStub = {
  listUserConfigurableTools: () => [],
} as unknown as RuntimeToolRegistry

function createRuntimeServicesMiddleware(
  registry: AgentRegistry,
  openCodeClient?: OpenCodeClient
): MiddlewareHandler {
  return async (c, next) => {
    c.set("agentRegistry", registry)
    c.set("providerService", providerServiceStub)
    c.set("toolRegistry", toolRegistryStub)
    if (openCodeClient) {
      c.set("openCodeClient", openCodeClient)
    }
    await next()
  }
}

async function createTempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agenthub-agents-router-"))
  tempDirs.push(dir)
  return dir
}

async function createApp(openCodeClient?: OpenCodeClient): Promise<Hono> {
  const registry = new AgentRegistry(await createTempDataDir(), emptyToolCatalog)
  await registry.initialize()

  const app = new Hono()
  app.use("*", createRuntimeServicesMiddleware(registry, openCodeClient))
  app.route("/", agentsRouter)
  return app
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("agents external settings routes", () => {
  test("updates claude-code external SDK settings", async () => {
    const app = await createApp()

    const response = await app.request("/runtime/agents/claude-code/external-settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider: "claude-code",
        model: "sonnet",
        permissionMode: "plan",
      }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      agentId: "claude-code",
      settings: {
        provider: "claude-code",
        model: "sonnet",
        permissionMode: "plan",
        updatedAt: expect.any(String),
      },
      updatedAt: expect.any(String),
    })
  })

  test("rejects mismatched external SDK settings provider", async () => {
    const app = await createApp()

    const response = await app.request("/runtime/agents/codex/external-settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider: "claude-code",
      }),
    })

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error.code).toBe("AGENT_EXTERNAL_SETTINGS_NOT_ALLOWED")
  })

  test("gets codex external SDK settings after saving", async () => {
    const app = await createApp()

    await app.request("/runtime/agents/codex/external-settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider: "codex",
        model: "gpt-5.1-codex",
      }),
    })

    const response = await app.request("/runtime/agents/codex/external-settings")

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      agentId: "codex",
      settings: {
        provider: "codex",
        model: "gpt-5.1-codex",
        updatedAt: expect.any(String),
      },
      updatedAt: expect.any(String),
    })
  })

  test("gets default external SDK settings when none are saved", async () => {
    const app = await createApp()

    const response = await app.request("/runtime/agents/codex/external-settings")

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      agentId: "codex",
      settings: {
        provider: "codex",
      },
    })
  })

  test("returns not found for non-external agent external SDK settings", async () => {
    const app = await createApp()

    const response = await app.request("/runtime/agents/coder/external-settings")

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error.code).toBe("AGENT_NOT_FOUND")
  })
})

describe("OpenCode model catalog route", () => {
  test("forwards workspace root to injected OpenCode client and returns catalog", async () => {
    const requestedRoots: string[] = []
    const catalog: OpenCodeModelCatalog = {
      provider: "opencode",
      models: [
        {
          providerID: "anthropic",
          providerName: "Anthropic",
          modelID: "claude-sonnet-4-5",
          modelName: "Claude Sonnet 4.5",
        },
      ],
      warnings: [],
    }
    const openCodeClient = {
      ensureSession: async () => {
        throw new Error("not used")
      },
      streamPrompt: async function* () {},
      listModels: async (workspaceRootPath: string) => {
        requestedRoots.push(workspaceRootPath)
        return catalog
      },
    } as OpenCodeClient
    const app = await createApp(openCodeClient)

    const response = await app.request("/runtime/agents/opencode/model-catalog", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspace: {
          workspaceId: "workspace_1",
          backendType: "local",
          rootPath: "D:\\workspace",
        },
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(catalog)
    expect(requestedRoots).toEqual(["D:\\workspace"])
  })

  test("rejects invalid request with 400", async () => {
    const app = await createApp()

    const response = await app.request("/runtime/agents/opencode/model-catalog", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspace: {
          workspaceId: "",
          backendType: "local",
          rootPath: "",
        },
      }),
    })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe("AGENT_INVALID_INPUT")
  })

  test("returns 502 when OpenCode client catalog lookup fails", async () => {
    const openCodeClient = {
      ensureSession: async () => {
        throw new Error("not used")
      },
      streamPrompt: async function* () {},
      listModels: async () => {
        throw new Error("OpenCode unavailable")
      },
    } as OpenCodeClient
    const app = await createApp(openCodeClient)

    const response = await app.request("/runtime/agents/opencode/model-catalog", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspace: {
          workspaceId: "workspace_1",
          backendType: "local",
          rootPath: "D:\\workspace",
        },
      }),
    })

    expect(response.status).toBe(502)
    const body = await response.json()
    expect(body.error.code).toBe("OPENCODE_MODEL_CATALOG_FAILED")
  })
})
