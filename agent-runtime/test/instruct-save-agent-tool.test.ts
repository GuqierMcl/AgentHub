import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentStore } from "../src/agents"
import { createInstructRuntimeToolRegistry } from "../src/instruct-runtime/tools"
import { createSaveAgentTool } from "../src/instruct-runtime/tools/save-agent-tool"
import type { ToolExecutionResult } from "../src/runtime/tools"
import type { InstructSaveAgentInput, InstructSaveAgentResult } from "../src/instruct-runtime/types"

async function createTempStore(): Promise<{ store: AgentStore; dataDir: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-instruct-save-agent-"))
  const store = new AgentStore(dataDir)
  return { store, dataDir }
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

function makeValidInput(overrides: Partial<InstructSaveAgentInput> = {}): InstructSaveAgentInput {
  return {
    name: "Test Agent",
    description: "A test agent for unit testing",
    systemPrompt: "You are a test agent.",
    capabilities: ["testing"],
    allowedTools: ["ls", "read_file"],
    allowedSubagents: [],
    permissionPolicy: {
      filesystem: "read",
      shell: "none",
      network: "none",
      deploy: "none",
    },
    ...overrides,
  }
}

describe("save_agent tool", () => {
  test("save_agent creates a user agent in AgentStore", async () => {
    const { store, dataDir } = await createTempStore()

    const tool = createSaveAgentTool(store)
    const input = makeValidInput({ id: "my_test_agent" })

    const result = await tool.execute(input, {
      runId: "run-1",
      input: {} as any,
      agent: { id: "instruct-agent", permissionPolicy: { filesystem: "none", shell: "none", network: "none", deploy: "none" }, allowedTools: ["save_agent"] } as any,
      signal: new AbortController().signal,
      toolCallId: "tc-1",
      emitEvent: () => {},
    })

    expect(result.status).toBe("completed")
    expect(result.summary).toContain("Created agent my_test_agent")

    const agents = await store.loadAgents()
    expect(agents).toHaveLength(1)
    expect(agents[0].id).toBe("my_test_agent")
    expect(agents[0].name).toBe("Test Agent")
    expect(agents[0].origin).toBe("user")
    expect(agents[0].tier).toBe("primary")
    expect(agents[0].readonly).toBe(false)
    expect(agents[0].enabled).toBe(true)

    await cleanup(dataDir)
  })

  test("save_agent result data contains agent.id", async () => {
    const { store, dataDir } = await createTempStore()

    const tool = createSaveAgentTool(store)
    const input = makeValidInput({ id: "my_test_agent" })

    const result = await tool.execute(input, {
      runId: "run-2",
      input: {} as any,
      agent: { id: "instruct-agent", permissionPolicy: { filesystem: "none", shell: "none", network: "none", deploy: "none" }, allowedTools: ["save_agent"] } as any,
      signal: new AbortController().signal,
      toolCallId: "tc-2",
      emitEvent: () => {},
    })

    expect(result.status).toBe("completed")
    const data = result.data as InstructSaveAgentResult
    expect(data.agent.id).toBe("my_test_agent")
    expect(data.agent.name).toBe("Test Agent")

    await cleanup(dataDir)
  })

  test("duplicate id returns AGENT_ALREADY_EXISTS", async () => {
    const { store, dataDir } = await createTempStore()

    const tool = createSaveAgentTool(store)
    const input = makeValidInput({ id: "dup_agent" })

    const first = await tool.execute(input, {
      runId: "run-3",
      input: {} as any,
      agent: { id: "instruct-agent", permissionPolicy: { filesystem: "none", shell: "none", network: "none", deploy: "none" }, allowedTools: ["save_agent"] } as any,
      signal: new AbortController().signal,
      toolCallId: "tc-3",
      emitEvent: () => {},
    })
    expect(first.status).toBe("completed")

    const second = await tool.execute(input, {
      runId: "run-4",
      input: {} as any,
      agent: { id: "instruct-agent", permissionPolicy: { filesystem: "none", shell: "none", network: "none", deploy: "none" }, allowedTools: ["save_agent"] } as any,
      signal: new AbortController().signal,
      toolCallId: "tc-4",
      emitEvent: () => {},
    })
    expect(second.status).toBe("failed")
    expect(second.error!.code).toBe("AGENT_ALREADY_EXISTS")

    await cleanup(dataDir)
  })

  test("system preset id returns AGENT_ALREADY_EXISTS", async () => {
    const { store, dataDir } = await createTempStore()

    const tool = createSaveAgentTool(store)
    const input = makeValidInput({ id: "orchestrator" })

    const result = await tool.execute(input, {
      runId: "run-5",
      input: {} as any,
      agent: { id: "instruct-agent", permissionPolicy: { filesystem: "none", shell: "none", network: "none", deploy: "none" }, allowedTools: ["save_agent"] } as any,
      signal: new AbortController().signal,
      toolCallId: "tc-5",
      emitEvent: () => {},
    })

    expect(result.status).toBe("failed")
    expect(result.error!.code).toBe("AGENT_ALREADY_EXISTS")

    await cleanup(dataDir)
  })

  test("invalid permission network=full returns AGENT_INVALID_INPUT", async () => {
    const { store, dataDir } = await createTempStore()

    const tool = createSaveAgentTool(store)
    const input = makeValidInput({
      id: "test_net_agent",
      allowedTools: ["ls"],
      permissionPolicy: {
        filesystem: "read",
        shell: "none",
        network: "full" as any,
        deploy: "none",
      },
    })

    const result = await tool.execute(input, {
      runId: "run-6",
      input: {} as any,
      agent: { id: "instruct-agent", permissionPolicy: { filesystem: "none", shell: "none", network: "none", deploy: "none" }, allowedTools: ["save_agent"] } as any,
      signal: new AbortController().signal,
      toolCallId: "tc-6",
      emitEvent: () => {},
    })

    expect(result.status).toBe("failed")
    expect(result.error!.code).toBe("AGENT_INVALID_INPUT")

    await cleanup(dataDir)
  })

  test("permission policy always returns complete object {filesystem, shell, network, deploy}", async () => {
    const { store, dataDir } = await createTempStore()

    const tool = createSaveAgentTool(store)
    const input = makeValidInput({
      id: "test_policy_agent",
      allowedTools: ["write_file"],
      permissionPolicy: {
        filesystem: "write",
      },
    })

    const result = await tool.execute(input, {
      runId: "run-7",
      input: {} as any,
      agent: { id: "instruct-agent", permissionPolicy: { filesystem: "none", shell: "none", network: "none", deploy: "none" }, allowedTools: ["save_agent"] } as any,
      signal: new AbortController().signal,
      toolCallId: "tc-7",
      emitEvent: () => {},
    })

    expect(result.status).toBe("completed")
    const data = result.data as InstructSaveAgentResult
    expect(data.agent.permissionPolicy).toEqual({
      filesystem: "write",
      shell: "none",
      network: "none",
      deploy: "none",
    })

    const agents = await store.loadAgents()
    expect(agents[0].permissionPolicy).toEqual({
      filesystem: "write",
      shell: "none",
      network: "none",
      deploy: "none",
    })

    await cleanup(dataDir)
  })

  test("non-none shell is rejected by authoring policy (v1 restriction)", async () => {
    const { store, dataDir } = await createTempStore()

    const tool = createSaveAgentTool(store)
    const input = makeValidInput({
      id: "test_shell_agent",
      allowedTools: ["ls"],
      permissionPolicy: {
        filesystem: "read",
        shell: "limited" as any,
        network: "none",
        deploy: "none",
      },
    })

    const result = await tool.execute(input, {
      runId: "run-8",
      input: {} as any,
      agent: { id: "instruct-agent", permissionPolicy: { filesystem: "none", shell: "none", network: "none", deploy: "none" }, allowedTools: ["save_agent"] } as any,
      signal: new AbortController().signal,
      toolCallId: "tc-8",
      emitEvent: () => {},
    })

    expect(result.status).toBe("failed")
    expect(result.error!.code).toBe("AGENT_INVALID_INPUT")
    // Details contain the actual violations
    const details = result.error!.details as Array<{ path: string[]; message: string }>
    expect(details.length).toBeGreaterThan(0)
    expect(details[0].message).toContain("shell")

    await cleanup(dataDir)
  })

  test("generates id when not provided", async () => {
    const { store, dataDir } = await createTempStore()

    const tool = createSaveAgentTool(store)
    const input = makeValidInput({ allowedTools: [] } as any)
    delete (input as any).id

    const result = await tool.execute(input, {
      runId: "run-9",
      input: {} as any,
      agent: { id: "instruct-agent", permissionPolicy: { filesystem: "none", shell: "none", network: "none", deploy: "none" }, allowedTools: ["save_agent"] } as any,
      signal: new AbortController().signal,
      toolCallId: "tc-9",
      emitEvent: () => {},
    })

    expect(result.status).toBe("completed")
    const data = result.data as InstructSaveAgentResult
    expect(data.agent.id).toMatch(/^agent_/)
    expect(data.agent.id.length).toBeGreaterThan("agent_".length)

    const agents = await store.loadAgents()
    expect(agents).toHaveLength(1)
    expect(agents[0].id).toMatch(/^agent_/)

    await cleanup(dataDir)
  })

  test("invalid tools are rejected with AGENT_INVALID_INPUT", async () => {
    const { store, dataDir } = await createTempStore()

    const tool = createSaveAgentTool(store)
    const input = makeValidInput({
      id: "test_tool_reject",
      allowedTools: ["ls", "bash", "web_fetch", "read_file"],
    })

    const result = await tool.execute(input, {
      runId: "run-10",
      input: {} as any,
      agent: { id: "instruct-agent", permissionPolicy: { filesystem: "none", shell: "none", network: "none", deploy: "none" }, allowedTools: ["save_agent"] } as any,
      signal: new AbortController().signal,
      toolCallId: "tc-10",
      emitEvent: () => {},
    })

    expect(result.status).toBe("failed")
    expect(result.error!.code).toBe("AGENT_INVALID_INPUT")

    await cleanup(dataDir)
  })

  test("write_file tool requires filesystem write permission", async () => {
    const { store, dataDir } = await createTempStore()

    const tool = createSaveAgentTool(store)
    const input = makeValidInput({
      id: "test_fs_write",
      allowedTools: ["write_file"],
      permissionPolicy: {
        filesystem: "read" as any,
      },
    })

    const result = await tool.execute(input, {
      runId: "run-11",
      input: {} as any,
      agent: { id: "instruct-agent", permissionPolicy: { filesystem: "none", shell: "none", network: "none", deploy: "none" }, allowedTools: ["save_agent"] } as any,
      signal: new AbortController().signal,
      toolCallId: "tc-11",
      emitEvent: () => {},
    })

    expect(result.status).toBe("failed")
    expect(result.error!.code).toBe("AGENT_INVALID_INPUT")
    const details2 = result.error!.details as Array<{ path: string[]; message: string }>
    expect(details2.length).toBeGreaterThan(0)
    expect(details2[0].message).toContain("filesystem")

    await cleanup(dataDir)
  })

  test("capabilities and subagents are deduplicated and trimmed", async () => {
    const { store, dataDir } = await createTempStore()

    const tool = createSaveAgentTool(store)
    const input = makeValidInput({
      id: "test_dedup",
      allowedTools: [] as any,
      capabilities: ["code-review", " code-review ", "testing"],
      allowedSubagents: ["explore", " explore", ""],
    })

    const result = await tool.execute(input, {
      runId: "run-12",
      input: {} as any,
      agent: { id: "instruct-agent", permissionPolicy: { filesystem: "none", shell: "none", network: "none", deploy: "none" }, allowedTools: ["save_agent"] } as any,
      signal: new AbortController().signal,
      toolCallId: "tc-12",
      emitEvent: () => {},
    })

    expect(result.status).toBe("completed")
    const data = result.data as InstructSaveAgentResult
    expect(data.agent.capabilities).toHaveLength(2)
    expect(data.agent.capabilities).toContain("code-review")
    expect(data.agent.capabilities).toContain("testing")

    await cleanup(dataDir)
  })
})

describe("InstructToolRegistry", () => {
  test("registers question and save_agent tools", async () => {
    const { dataDir } = await createTempStore()

    const registry = createInstructRuntimeToolRegistry(dataDir)
    const tools = registry.listToolsForAgent({ allowedTools: ["question", "save_agent"] })

    expect(tools).toHaveLength(2)
    expect(tools.map((t) => t.name)).toContain("question")
    expect(tools.map((t) => t.name)).toContain("save_agent")

    await cleanup(dataDir)
  })

  test("save_agent is internal and not configurable by user agent", async () => {
    const { dataDir } = await createTempStore()

    const registry = createInstructRuntimeToolRegistry(dataDir)
    const tool = registry.getTool("save_agent")

    expect(tool).not.toBeNull()
    expect(tool!.internal).toBe(true)
    expect(tool!.configurableByUserAgent).toBe(false)

    await cleanup(dataDir)
  })

  test("question tool is registered as deferred", async () => {
    const { dataDir } = await createTempStore()

    const registry = createInstructRuntimeToolRegistry(dataDir)
    const tool = registry.getTool("question")

    expect(tool).not.toBeNull()
    expect(tool!.deferred).toBe(true)

    await cleanup(dataDir)
  })
})
