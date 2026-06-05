import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentRegistry } from "../src/agents"
import { InstructAgentRegistry } from "../src/agents/instruct-agent-registry"
import { createDefaultRuntimeToolRegistry } from "../src/runtime"

async function createRegistry(): Promise<AgentRegistry> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-instruct-agent-def-"))
  return new AgentRegistry(dataDir, createDefaultRuntimeToolRegistry())
}

describe("instruct-agent definition", () => {
  test("InstructAgentRegistry contains instruct-agent", () => {
    const registry = new InstructAgentRegistry()

    const agent = registry.getAgent("instruct-agent")
    expect(agent).not.toBeNull()
    expect(agent!.id).toBe("instruct-agent")
    expect(agent!.name).toBe("Instruct Agent")
    expect(agent!.tier).toBe("primary")
    expect(agent!.origin).toBe("system")
    expect(agent!.readonly).toBe(true)
    expect(agent!.executorType).toBe("ai-sdk")
  })

  test("InstructAgentRegistry.getDefaultInstructAgent returns instruct-agent", () => {
    const registry = new InstructAgentRegistry()

    const agent = registry.getDefaultInstructAgent()
    expect(agent.id).toBe("instruct-agent")
  })

  test("InstructAgentRegistry.listAgents returns only instruct-agent", () => {
    const registry = new InstructAgentRegistry()

    const agents = registry.listAgents()
    expect(agents.length).toBe(1)
    expect(agents[0].id).toBe("instruct-agent")
  })

  test("instruct-agent allowedTools are only question and save_agent", () => {
    const registry = new InstructAgentRegistry()
    const agent = registry.getAgent("instruct-agent")!

    expect(agent.allowedTools).toHaveLength(2)
    expect(agent.allowedTools).toContain("question")
    expect(agent.allowedTools).toContain("save_agent")
  })

  test("normal AgentRegistry does not contain instruct-agent", async () => {
    const registry = await createRegistry()
    await registry.initialize()

    const agent = registry.getAgent("instruct-agent")
    expect(agent).toBeNull()

    const names = registry.listAgents().map((a) => a.id)
    expect(names).not.toContain("instruct-agent")
  })

  test("instruct-agent has no filesystem/shell/network/deploy permissions", () => {
    const registry = new InstructAgentRegistry()
    const agent = registry.getAgent("instruct-agent")!

    expect(agent.permissionPolicy.filesystem).toBe("none")
    expect(agent.permissionPolicy.shell).toBe("none")
    expect(agent.permissionPolicy.network).toBe("none")
    expect(agent.permissionPolicy.deploy).toBe("none")
  })

  test("instruct-agent is not callable from normal chat", () => {
    const registry = new InstructAgentRegistry()
    const agent = registry.getAgent("instruct-agent")!

    expect(agent.visibility).toBe("visible")
    expect(agent.delegationPolicy).toBe("terminal")
  })
})
