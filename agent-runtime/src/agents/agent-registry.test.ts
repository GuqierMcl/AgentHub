import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentRegistry, AgentRegistryMutationError } from "./agent-registry"
import type { AgentToolAuthoringCatalog } from "./types"

const tempDirs: string[] = []

const emptyToolCatalog: AgentToolAuthoringCatalog = {
  listUserConfigurableTools: () => [],
}

async function createTempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agenthub-agent-registry-"))
  tempDirs.push(dir)
  return dir
}

async function createRegistry(): Promise<AgentRegistry> {
  const registry = new AgentRegistry(await createTempDataDir(), emptyToolCatalog)
  await registry.initialize()
  return registry
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("AgentRegistry external agent settings", () => {
  test("allows external SDK settings only for preset external agents", async () => {
    const registry = await createRegistry()

    const opencode = await registry.setExternalAgentSettings("opencode", {
      provider: "opencode",
      model: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
      },
      executionAgent: "build",
    })

    expect(opencode.externalSettings).toEqual({
      provider: "opencode",
      model: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
      },
      executionAgent: "build",
      updatedAt: expect.any(String),
    })

    await expect(registry.setExternalAgentSettings("coder", {
      provider: "codex",
      model: "gpt-5.1-codex",
    })).rejects.toMatchObject({
      code: "AGENT_EXTERNAL_SETTINGS_NOT_ALLOWED",
    })
  })

  test("keeps external SDK settings separate from internal model bindings", async () => {
    const registry = await createRegistry()

    await registry.setExternalAgentSettings("codex", {
      provider: "codex",
      model: "gpt-5.1-codex",
    })

    expect(registry.isModelBindingAllowed("codex")).toBe(false)
    expect(registry.getAgent("codex")?.modelRef).toBeUndefined()
    expect(registry.getAgent("codex")?.externalSettings).toEqual({
      provider: "codex",
      model: "gpt-5.1-codex",
      updatedAt: expect.any(String),
    })
  })

  test("drops persisted internal model bindings for external agents during initialization", async () => {
    const dataDir = await createTempDataDir()
    await writeFile(
      join(dataDir, "agent-model-bindings.json"),
      JSON.stringify({
        codex: {
          providerId: "openai",
          modelId: "gpt-5.1",
        },
        coder: {
          providerId: "openai",
          modelId: "gpt-5.1",
        },
      }),
      "utf-8"
    )

    const registry = new AgentRegistry(dataDir, emptyToolCatalog)
    const originalWarn = console.warn
    console.warn = () => undefined
    try {
      await registry.initialize()
    } finally {
      console.warn = originalWarn
    }

    expect(registry.isModelBindingAllowed("codex")).toBe(false)
    expect(registry.getAgent("codex")?.modelRef).toBeUndefined()
    expect(registry.getAgent("coder")?.modelRef).toEqual({
      providerId: "openai",
      modelId: "gpt-5.1",
    })
  })

  test("persists and reloads external SDK settings as an overlay", async () => {
    const dataDir = await createTempDataDir()
    const registry = new AgentRegistry(dataDir, emptyToolCatalog)
    await registry.initialize()

    await registry.setExternalAgentSettings("claude-code", {
      provider: "claude-code",
      model: "sonnet",
      permissionMode: "plan",
    })

    const reloaded = new AgentRegistry(dataDir, emptyToolCatalog)
    await reloaded.initialize()

    expect(reloaded.getExternalAgentSettings("claude-code")).toEqual({
      provider: "claude-code",
      model: "sonnet",
      permissionMode: "plan",
      updatedAt: expect.any(String),
    })
    expect(reloaded.getAgent("claude-code")?.externalSettings).toEqual(
      reloaded.getExternalAgentSettings("claude-code")
    )
  })

  test("returns cloned external SDK settings", async () => {
    const registry = await createRegistry()
    await registry.setExternalAgentSettings("codex", {
      provider: "codex",
      model: "gpt-5.1-codex",
    })

    const settings = registry.getExternalAgentSettings("codex")
    if (!settings || settings.provider !== "codex") {
      throw new Error("Expected codex settings")
    }
    settings.model = "mutated"

    expect(registry.getExternalAgentSettings("codex")).toEqual({
      provider: "codex",
      model: "gpt-5.1-codex",
      updatedAt: expect.any(String),
    })
  })

  test("uses registry mutation error for disallowed external SDK settings", async () => {
    const registry = await createRegistry()

    try {
      await registry.setExternalAgentSettings("codex", {
        provider: "claude-code",
        model: "sonnet",
      })
    } catch (error) {
      expect(error).toBeInstanceOf(AgentRegistryMutationError)
      expect(error).toMatchObject({
        code: "AGENT_EXTERNAL_SETTINGS_NOT_ALLOWED",
        status: 403,
      })
    }
  })
})
