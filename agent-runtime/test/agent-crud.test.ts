import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentRegistry, AgentRegistryMutationError } from "../src/agents"
import { createDefaultRuntimeToolRegistry } from "../src/runtime"
import agentsRouter from "../src/routers/agents"
import type { ProviderService } from "../src/provider"

const readOnlyPolicy = {
  filesystem: "read",
  shell: "none",
  network: "none",
  deploy: "none",
} as const
const writePolicy = {
  filesystem: "write",
  shell: "none",
  network: "none",
  deploy: "none",
} as const
const EXPECTED_AUTHORING_TOOL_IDS = ["ls", "read_file", "glob", "grep", "write_file", "edit_file"] as const

async function createInitializedRegistry(): Promise<{
  dataDir: string
  registry: AgentRegistry
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-agent-crud-"))
  const registry = new AgentRegistry(dataDir, createDefaultRuntimeToolRegistry())
  await registry.initialize()
  return {
    dataDir,
    registry,
  }
}

function createProviderService(): ProviderService {
  return {
    getProvider: () => null,
    getModel: () => null,
  } as unknown as ProviderService
}

function createAgentsApp(registry: AgentRegistry): Hono {
  const app = new Hono()
  app.use("*", async (c: Context, next: Next) => {
    c.set("agentRegistry", registry)
    c.set("providerService", createProviderService())
    c.set("toolRegistry", createDefaultRuntimeToolRegistry())
    await next()
  })
  app.route("/", agentsRouter)
  return app
}

function createUserAgentPayload(overrides: Record<string, unknown> = {}): any {
  return {
    id: "custom_writer",
    name: "Custom Writer",
    description: "Writes with a custom voice.",
    systemPrompt: "You are a careful custom writing agent.",
    capabilities: ["writing"],
    allowedSubagents: ["general"],
    allowedTools: ["ls"],
    permissionPolicy: readOnlyPolicy,
    enabled: true,
    ...overrides,
  }
}

async function readPersistedAgents(dataDir: string): Promise<Array<{ id: string; name: string }>> {
  return JSON.parse(await readFile(join(dataDir, "agents.json"), "utf-8"))
}

describe("user agent CRUD", () => {
  test("creates, updates, persists, and deletes a user primary agent", async () => {
    const { dataDir, registry } = await createInitializedRegistry()

    const created = await registry.createUserAgent(createUserAgentPayload())
    expect(created).toMatchObject({
      id: "custom_writer",
      origin: "user",
      tier: "primary",
      visibility: "visible",
      entryPolicy: "callable",
      executorType: "ai-sdk",
      readonly: false,
      systemPrompt: "You are a careful custom writing agent.",
      allowedSubagents: ["general"],
      allowedTools: ["ls"],
    })

    expect(await readPersistedAgents(dataDir)).toMatchObject([
      {
        id: "custom_writer",
        name: "Custom Writer",
      },
    ])

    const updated = await registry.updateUserAgent("custom_writer", {
      name: "Custom Editor",
      allowedTools: [],
      enabled: false,
      permissionPolicy: {
        filesystem: "none",
        shell: "none",
        network: "none",
        deploy: "none",
      },
    })

    expect(updated).toMatchObject({
      id: "custom_writer",
      name: "Custom Editor",
      allowedTools: [],
      enabled: false,
      permissionPolicy: {
        filesystem: "none",
      },
    })

    expect(registry.listAgents({ enabledOnly: false, origin: "user" })).toHaveLength(1)

    await expect(registry.deleteUserAgent("custom_writer")).resolves.toBe(true)
    expect(registry.getAgent("custom_writer")).toBeNull()
    expect(await readPersistedAgents(dataDir)).toEqual([])
  })

  test("rejects non-editable agents and unsafe custom agent settings", async () => {
    const { registry } = await createInitializedRegistry()

    await expect(registry.createUserAgent(createUserAgentPayload({
      id: "tool_enabled_agent",
      allowedTools: [...EXPECTED_AUTHORING_TOOL_IDS],
      permissionPolicy: writePolicy,
    }))).resolves.toMatchObject({
      id: "tool_enabled_agent",
      allowedTools: [...EXPECTED_AUTHORING_TOOL_IDS],
      permissionPolicy: {
        filesystem: "write",
      },
    })

    await expect(registry.createUserAgent(createUserAgentPayload({ id: "coder" }))).rejects.toMatchObject({
      code: "AGENT_ALREADY_EXISTS",
      status: 409,
    })

    await expect(registry.updateUserAgent("coder", { name: "Nope" })).rejects.toMatchObject({
      code: "AGENT_NOT_EDITABLE",
      status: 403,
    })

    await expect(registry.deleteUserAgent("coder")).rejects.toMatchObject({
      code: "AGENT_NOT_EDITABLE",
      status: 403,
    })

    await expect(registry.createUserAgent(createUserAgentPayload({
      id: "bad_subagent",
      allowedSubagents: ["coder"],
    }))).rejects.toBeInstanceOf(AgentRegistryMutationError)

    await expect(registry.createUserAgent(createUserAgentPayload({
      id: "bad_tool",
      allowedTools: ["run_task"],
    }))).rejects.toMatchObject({
      code: "AGENT_INVALID_INPUT",
      status: 400,
    })

    await expect(registry.createUserAgent(createUserAgentPayload({
      id: "bad_policy",
      allowedTools: ["write_file"],
      permissionPolicy: {
        filesystem: "read",
        shell: "none",
        network: "none",
        deploy: "none",
      },
    }))).rejects.toMatchObject({
      code: "AGENT_INVALID_INPUT",
      status: 400,
    })
  })

  test("exposes CRUD through Runtime agents API and only returns user systemPrompt", async () => {
    const { registry } = await createInitializedRegistry()
    const app = createAgentsApp(registry)

    const createResponse = await app.request("/runtime/agents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(createUserAgentPayload()),
    })
    const created = await createResponse.json()

    expect(createResponse.status).toBe(201)
    expect(created.systemPrompt).toBe("You are a careful custom writing agent.")

    const detailResponse = await app.request("/runtime/agents/custom_writer")
    const detail = await detailResponse.json()
    expect(detailResponse.status).toBe(200)
    expect(detail.systemPrompt).toBe("You are a careful custom writing agent.")

    const systemDetailResponse = await app.request("/runtime/agents/coder")
    const systemDetail = await systemDetailResponse.json()
    expect(systemDetailResponse.status).toBe(200)
    expect(systemDetail.systemPrompt).toBeUndefined()

    const updateResponse = await app.request("/runtime/agents/custom_writer", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        description: "Updated description.",
      }),
    })
    const updated = await updateResponse.json()
    expect(updateResponse.status).toBe(200)
    expect(updated.description).toBe("Updated description.")

    const deleteResponse = await app.request("/runtime/agents/custom_writer", {
      method: "DELETE",
    })
    expect(deleteResponse.status).toBe(200)
    expect(await deleteResponse.json()).toEqual({
      agentId: "custom_writer",
      deleted: true,
    })

    const missingResponse = await app.request("/runtime/agents/custom_writer")
    expect(missingResponse.status).toBe(404)
  })

  test("exposes user agent authoring options for tools, capability tags, subagents, and defaults", async () => {
    const { registry } = await createInitializedRegistry()
    const app = createAgentsApp(registry)

    const response = await app.request("/runtime/agents/authoring-options")
    const options = await response.json()

    expect(response.status).toBe(200)
    expect(options.tools.map((tool: { id: string }) => tool.id)).toEqual([...EXPECTED_AUTHORING_TOOL_IDS])
    expect(options.tools.map((tool: { id: string }) => tool.id)).not.toContain("run_task")
    expect(options.tools.map((tool: { id: string }) => tool.id)).not.toContain("write_plan")
    expect(options.tools.every((tool: { category: string; approvalPolicy: string }) =>
      tool.category === "workspace" && tool.approvalPolicy === "contextual"
    )).toBe(true)
    const toolsById = new Map<string, { id: string; requiredPermissions: { filesystem?: string } }>(
      options.tools.map((tool: { id: string; requiredPermissions: { filesystem?: string } }) => [tool.id, tool])
    )
    expect(toolsById.get("ls")?.requiredPermissions.filesystem).toBe("read")
    expect(toolsById.get("read_file")?.requiredPermissions.filesystem).toBe("read")
    expect(toolsById.get("write_file")?.requiredPermissions.filesystem).toBe("write")
    expect(toolsById.get("edit_file")?.requiredPermissions.filesystem).toBe("write")

    expect(options.capabilityTags.map((tag: { id: string }) => tag.id)).toEqual(expect.arrayContaining([
      "implementation",
      "review",
      "documentation",
      "planning-advice",
      "research",
      "summarization",
      "rewrite",
      "codebase-scan",
    ]))

    expect(options.subagents.map((agent: { id: string }) => agent.id)).toEqual(expect.arrayContaining([
      "explore",
      "general",
      "file",
      "deploy",
    ]))
    expect(options.subagents.map((agent: { id: string }) => agent.id)).not.toContain("coder")

    expect(options.defaults).toEqual({
      allowedTools: [],
      allowedSubagents: [],
      permissionPolicy: {
        filesystem: "none",
        shell: "none",
        network: "none",
        deploy: "none",
      },
    })
  })
})
