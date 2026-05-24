import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentRegistry } from "../src/agents"

async function createRegistry(): Promise<AgentRegistry> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-agent-registry-"))
  return new AgentRegistry(dataDir)
}

describe("AgentRegistry model binding rules", () => {
  test("orchestrator can bind a model", async () => {
    const registry = await createRegistry()

    expect(registry.isModelBindingAllowed("orchestrator")).toBe(true)

    const updated = await registry.setAgentModelBinding("orchestrator", {
      providerId: "deepseek",
      modelId: "deepseek-v4-pro",
    })

    expect(updated?.modelRef).toEqual({
      providerId: "deepseek",
      modelId: "deepseek-v4-pro",
    })
    expect(registry.getAgent("orchestrator")?.modelRef).toEqual({
      providerId: "deepseek",
      modelId: "deepseek-v4-pro",
    })
  })

  test("external and hidden agents cannot bind models", async () => {
    const registry = await createRegistry()

    expect(registry.isModelBindingAllowed("opencode")).toBe(false)
    expect(registry.isModelBindingAllowed("explore")).toBe(false)

    await expect(
      registry.setAgentModelBinding("opencode", {
        providerId: "deepseek",
        modelId: "deepseek-v4-pro",
      })
    ).resolves.toBeNull()

    await expect(
      registry.setAgentModelBinding("explore", {
        providerId: "deepseek",
        modelId: "deepseek-v4-pro",
      })
    ).resolves.toBeNull()
  })
})
