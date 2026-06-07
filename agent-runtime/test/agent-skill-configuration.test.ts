import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentDefinitionSchema, AgentRegistry } from "../src/agents"
import { createDefaultRuntimeToolRegistry } from "../src/runtime"

async function createRegistry(): Promise<AgentRegistry> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-skill-config-"))
  const registry = new AgentRegistry(dataDir, createDefaultRuntimeToolRegistry())
  await registry.initialize()
  return registry
}

describe("agent skill configuration", () => {
  test("AgentDefinitionSchema defaults allowedSkills to an empty array", () => {
    const parsed = AgentDefinitionSchema.parse({
      id: "skill_test",
      name: "Skill Test",
      description: "Tests allowedSkills",
      tier: "primary",
      origin: "user",
      visibility: "visible",
      entryPolicy: "callable",
      delegationPolicy: "can-delegate",
      executorType: "ai-sdk",
      capabilities: [],
      allowedSubagents: [],
      allowedTools: [],
      permissionPolicy: {
        filesystem: "none",
        shell: "none",
        network: "none",
        deploy: "none",
      },
    })

    expect(parsed.allowedSkills).toEqual([])
  })

  test("user agents preserve normalized global allowedSkills", async () => {
    const registry = await createRegistry()
    const agent = await registry.createUserAgent({
      id: "skill_user",
      name: "Skill User",
      description: "Uses selected Skills",
      systemPrompt: "Use approved instructions.",
      capabilities: [],
      allowedSubagents: [],
      allowedTools: [],
      allowedSkills: [
        " global:agents:review ",
        "global:agents:review",
        "global:codex:.system:openai-docs",
      ],
      enabled: true,
    })

    expect(agent.allowedSkills).toEqual([
      "global:agents:review",
      "global:codex:.system:openai-docs",
    ])
  })

  test("user agents reject workspace allowedSkills until trust exists", async () => {
    const registry = await createRegistry()

    await expect(registry.createUserAgent({
      id: "workspace_skill_user",
      name: "Workspace Skill User",
      description: "Rejected for now",
      systemPrompt: "Use approved instructions.",
      capabilities: [],
      allowedSubagents: [],
      allowedTools: [],
      allowedSkills: ["workspace:agents:local-review"],
      enabled: true,
    })).rejects.toMatchObject({
      code: "AGENT_INVALID_INPUT",
      status: 400,
    })
  })
})
