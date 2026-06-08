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

function createRuntimeServicesMiddleware(registry: AgentRegistry): MiddlewareHandler {
  return async (c, next) => {
    c.set("agentRegistry", registry)
    c.set("providerService", providerServiceStub)
    c.set("toolRegistry", toolRegistryStub)
    await next()
  }
}

async function createTempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agenthub-agents-router-"))
  tempDirs.push(dir)
  return dir
}

async function createApp(): Promise<Hono> {
  const registry = new AgentRegistry(await createTempDataDir(), emptyToolCatalog)
  await registry.initialize()

  const app = new Hono()
  app.use("*", createRuntimeServicesMiddleware(registry))
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
    expect(body.externalSettings).toEqual({
      provider: "claude-code",
      model: "sonnet",
      permissionMode: "plan",
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
    expect(body.externalSettings).toEqual({
      provider: "codex",
      model: "gpt-5.1-codex",
      updatedAt: expect.any(String),
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
