import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, test } from "bun:test"
import {
  CapabilityDiscoveryService,
  McpRuntimeService,
  McpTrustService,
  RuntimeToolRegistry,
  hashMcpTrustWorkspaceRoot,
  type AgentExecutionContext,
  type McpRuntimeClient,
  type McpServerRuntimeConfig,
  type RunEvent,
  type ToolDefinition,
} from "../src/runtime"

async function createTempWorkspace(prefix: string): Promise<{
  root: string
  homeDir: string
  dataDir: string
  workspace: { workspaceId: string; backendType: "local"; rootPath: string }
}> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  const homeDir = join(root, "home")
  const dataDir = join(root, "data")
  const workspaceRoot = join(root, "workspace")
  await mkdir(homeDir, { recursive: true })
  await mkdir(dataDir, { recursive: true })
  await mkdir(workspaceRoot, { recursive: true })
  return {
    root,
    homeDir,
    dataDir,
    workspace: {
      workspaceId: "workspace_1",
      backendType: "local",
      rootPath: workspaceRoot,
    },
  }
}

function fakeAgent(overrides: Partial<AgentExecutionContext["agent"]> = {}): AgentExecutionContext["agent"] {
  return {
    id: "coder",
    name: "Coder",
    description: "Writes code",
    executorType: "ai-sdk",
    tier: "primary",
    visibility: "visible",
    origin: "system",
    capabilities: [],
    allowedTools: [],
    allowedSubagents: [],
    allowedSkills: [],
    permissionPolicy: {
      filesystem: "read",
      shell: "none",
      network: "none",
      deploy: "none",
    },
    toolPermissionRules: {},
    entryPolicy: "callable",
    delegationPolicy: "terminal",
    enabled: true,
    readonly: true,
    ...overrides,
  }
}

function fakeContext(
  overrides: Partial<AgentExecutionContext> = {}
): AgentExecutionContext {
  const signal = new AbortController().signal
  return {
    runId: "run_mcp",
    input: {
      conversationId: "conv_1",
      mode: "single",
      participantAgentIds: ["coder"],
      userMessage: { role: "user", content: "use mcp" },
      history: [],
      pinnedMessages: [],
    },
    agent: fakeAgent(),
    signal,
    ...overrides,
  }
}

function createFakeClientFactory(calls: Array<{ config: McpServerRuntimeConfig; name: string }> = []) {
  const clients = new Map<string, McpRuntimeClient>()
  const factory = (config: McpServerRuntimeConfig): McpRuntimeClient => {
    calls.push({ config, name: config.name })
    const client: McpRuntimeClient = {
      async connect() {},
      async listTools() {
        return {
          tools: [
            {
              name: "search",
              description: "Search the workspace index",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string" },
                },
                required: ["query"],
              },
            },
          ],
        }
      },
      async callTool(params) {
        return {
          content: [{ type: "text", text: `result:${params.name}` }],
          structuredContent: { ok: true, arguments: params.arguments },
        }
      },
      async close() {},
    }
    clients.set(config.id, client)
    return client
  }
  return { factory, clients }
}

describe("McpRuntimeService", () => {
  test("resolves raw workspace MCP config internally while public discovery stays redacted", async () => {
    const { homeDir, dataDir, workspace } = await createTempWorkspace("agent-runtime-mcp-runtime-config-")
    await writeFile(join(workspace.rootPath, "opencode.jsonc"), `{
      "mcp": {
        "secretServer": {
          "type": "local",
          "command": ["node", "server.js", "--token", "sk-secret-value"],
          "env": { "API_TOKEN": "sk-env-value" },
          "headers": { "Authorization": "Bearer secret" },
          "cwd": "${workspace.rootPath.replace(/\\/g, "\\\\")}"
        }
      }
    }`, "utf-8")

    const discovery = new CapabilityDiscoveryService({ homeDir, dataDir })
    const publicResponse = await discovery.discover({ scope: "workspace", workspace, sources: ["opencode"] })
    expect(JSON.stringify(publicResponse)).not.toContain("sk-env-value")
    expect(JSON.stringify(publicResponse)).not.toContain("Bearer secret")
    expect(JSON.stringify(publicResponse)).not.toContain(workspace.rootPath)
    expect(publicResponse.mcps[0]?.args).toContain("[REDACTED]")

    const configs = await discovery.listMcpRuntimeConfigs({ scope: "workspace", workspace, sources: ["opencode"] })
    expect(configs).toHaveLength(1)
    expect(configs[0]).toMatchObject({
      name: "secretServer",
      source: "opencode",
      level: "workspace",
      transport: "stdio",
      command: "node",
      args: ["server.js", "--token", "sk-secret-value"],
      env: { API_TOKEN: "sk-env-value" },
      headers: { Authorization: "Bearer secret" },
      cwd: workspace.rootPath,
    })
  })

  test("default trusted workspace MCP is enabled, connected, enumerated, and callable through registry events", async () => {
    const { homeDir, dataDir, workspace } = await createTempWorkspace("agent-runtime-mcp-runtime-trusted-")
    await writeFile(join(workspace.rootPath, "opencode.json"), JSON.stringify({
      mcp: {
        docs: {
          type: "local",
          command: ["node", "docs-server.js"],
        },
      },
    }), "utf-8")

    const discovery = new CapabilityDiscoveryService({ homeDir, dataDir })
    const trust = new McpTrustService({ dataDir })
    await trust.initialize()
    const calls: Array<{ config: McpServerRuntimeConfig; name: string }> = []
    const mcpRuntime = new McpRuntimeService({
      discoveryService: discovery,
      trustService: trust,
      clientFactory: createFakeClientFactory(calls).factory,
    })

    const status = await mcpRuntime.ensureWorkspaceStatus({ workspace })
    expect(status.workspace.workspaceRootHash).toBe(hashMcpTrustWorkspaceRoot(workspace.rootPath))
    expect(status.summary).toMatchObject({
      enabledCount: 1,
      connectedCount: 1,
      errorCount: 0,
      toolCount: 1,
    })
    expect(status.servers[0]).toMatchObject({
      name: "docs",
      enabled: true,
      trusted: true,
      status: "connected",
      toolCount: 1,
    })
    expect(JSON.stringify(status)).not.toContain(workspace.rootPath)
    expect(calls).toHaveLength(1)

    const events: RunEvent[] = []
    const context = fakeContext({
      input: {
        ...fakeContext().input,
        workspace,
      },
      mcpContext: await mcpRuntime.resolveWorkspaceMcpContext({ workspace }),
      emitEvent: (event) => events.push(event),
    })
    const registry = new RuntimeToolRegistry()
    const settings = await registry.buildAiSdkToolSettings(context)
    expect(settings?.activeTools).toEqual(["mcp_docs_search"])

    const definition = context.mcpContext?.toolDefinitions[0] as ToolDefinition
    const result = await registry.executeDynamicTool(definition, { query: "abc" }, context, {
      toolCallId: "tool_mcp_1",
    })
    expect(result.status).toBe("completed")
    expect(result.data).toMatchObject({
      serverId: status.servers[0]?.id,
      toolName: "search",
      result: {
        structuredContent: { ok: true, arguments: { query: "abc" } },
      },
    })
    expect(events.map((event) => event.type)).toEqual(["tool.started", "tool.completed"])
    expect(events[0]?.data).toMatchObject({
      externalProvider: "mcp",
      serverName: "docs",
      mcpToolName: "search",
    })
    expect(JSON.stringify(events)).not.toContain(workspace.rootPath)
  })

  test("deduplicates equivalent workspace MCP servers across source-specific configs", async () => {
    const { homeDir, dataDir, workspace } = await createTempWorkspace("agent-runtime-mcp-runtime-dedupe-")
    await mkdir(join(workspace.rootPath, ".claude"), { recursive: true })
    await writeFile(join(workspace.rootPath, ".mcp.json"), JSON.stringify({
      mcpServers: {
        docs: {
          command: "node",
          args: ["claude-docs-server.js"],
        },
      },
    }), "utf-8")
    await writeFile(join(workspace.rootPath, "opencode.json"), JSON.stringify({
      mcp: {
        docs: {
          type: "local",
          command: ["node", "opencode-docs-server.js"],
        },
      },
    }), "utf-8")

    const discovery = new CapabilityDiscoveryService({ homeDir, dataDir })
    const trust = new McpTrustService({ dataDir })
    await trust.initialize()
    const calls: Array<{ config: McpServerRuntimeConfig; name: string }> = []
    const mcpRuntime = new McpRuntimeService({
      discoveryService: discovery,
      trustService: trust,
      clientFactory: createFakeClientFactory(calls).factory,
    })

    const publicConfigs = await discovery.listMcpRuntimeConfigs({ scope: "workspace", workspace })
    expect(publicConfigs.filter((config) => config.name === "docs")).toHaveLength(2)

    const status = await mcpRuntime.ensureWorkspaceStatus({ workspace })
    expect(status.summary).toMatchObject({
      serverCount: 1,
      enabledCount: 1,
      connectedCount: 1,
      errorCount: 0,
      toolCount: 1,
    })
    expect(status.servers[0]).toMatchObject({
      name: "docs",
      source: "claude-code",
      status: "connected",
      duplicateCount: 2,
      sources: ["claude-code", "opencode"],
    })
    expect(calls.map((call) => call.config.source)).toEqual(["claude-code"])

    const context = await mcpRuntime.resolveWorkspaceMcpContext({ workspace })
    expect(context.servers).toHaveLength(1)
    expect(context.tools.map((tool) => tool.toolName)).toEqual(["mcp_docs_search"])
    expect(context.toolDefinitions).toHaveLength(1)
  })

  test("falls back to the next trusted duplicate MCP server when the preferred source fails", async () => {
    const { homeDir, dataDir, workspace } = await createTempWorkspace("agent-runtime-mcp-runtime-dedupe-fallback-")
    await writeFile(join(workspace.rootPath, ".mcp.json"), JSON.stringify({
      mcpServers: {
        docs: {
          command: "node",
          args: ["broken-claude-docs-server.js"],
        },
      },
    }), "utf-8")
    await writeFile(join(workspace.rootPath, "opencode.json"), JSON.stringify({
      mcp: {
        docs: {
          type: "local",
          command: ["node", "opencode-docs-server.js"],
        },
      },
    }), "utf-8")

    const discovery = new CapabilityDiscoveryService({ homeDir, dataDir })
    const trust = new McpTrustService({ dataDir })
    await trust.initialize()
    const calls: string[] = []
    const mcpRuntime = new McpRuntimeService({
      discoveryService: discovery,
      trustService: trust,
      clientFactory: (config) => {
        calls.push(config.source)
        if (config.source === "claude-code") {
          return {
            async connect() {
              throw new Error("preferred source failed")
            },
            async listTools() {
              return { tools: [] }
            },
            async callTool() {
              return {}
            },
          }
        }
        return createFakeClientFactory().factory(config)
      },
    })

    const status = await mcpRuntime.ensureWorkspaceStatus({ workspace })
    expect(calls).toEqual(["claude-code", "opencode"])
    expect(status.summary).toMatchObject({
      serverCount: 1,
      connectedCount: 1,
      errorCount: 0,
      toolCount: 1,
    })
    expect(status.servers[0]).toMatchObject({
      name: "docs",
      source: "opencode",
      status: "connected",
      duplicateCount: 2,
      sources: ["claude-code", "opencode"],
    })
    expect(mcpRuntime.getStatus().status).toBe("running")
    expect(mcpRuntime.getStatus().details.errorServerCount).toBe(0)
  })

  test("explicitly revoked workspace MCP stays disabled and is not injected", async () => {
    const { homeDir, dataDir, workspace } = await createTempWorkspace("agent-runtime-mcp-runtime-revoked-")
    await writeFile(join(workspace.rootPath, "opencode.json"), JSON.stringify({
      mcp: {
        docs: {
          type: "local",
          command: ["node", "docs-server.js"],
        },
      },
    }), "utf-8")

    const discovery = new CapabilityDiscoveryService({ homeDir, dataDir })
    const [config] = await discovery.listMcpRuntimeConfigs({ scope: "workspace", workspace, sources: ["opencode"] })
    const trust = new McpTrustService({ dataDir })
    await trust.initialize()
    await trust.decide({
      scope: "workspace",
      workspace,
      mcpRef: config.id,
      trusted: false,
    })
    const calls: Array<{ config: McpServerRuntimeConfig; name: string }> = []
    const mcpRuntime = new McpRuntimeService({
      discoveryService: discovery,
      trustService: trust,
      clientFactory: createFakeClientFactory(calls).factory,
    })

    const status = await mcpRuntime.ensureWorkspaceStatus({ workspace })
    expect(status.summary).toMatchObject({
      enabledCount: 0,
      connectedCount: 0,
      errorCount: 0,
      toolCount: 0,
    })
    expect(status.servers[0]).toMatchObject({
      enabled: false,
      trusted: false,
      status: "disabled",
    })
    expect(calls).toHaveLength(0)

    const context = await mcpRuntime.resolveWorkspaceMcpContext({ workspace })
    expect(context.tools).toHaveLength(0)
    expect(context.toolDefinitions).toHaveLength(0)
  })

  test("connect errors are isolated to one server and redacted from status", async () => {
    const { homeDir, dataDir, workspace } = await createTempWorkspace("agent-runtime-mcp-runtime-error-")
    await writeFile(join(workspace.rootPath, "opencode.json"), JSON.stringify({
      mcp: {
        broken: {
          type: "local",
          command: ["node", "broken.js"],
          env: { TOKEN: "sk-leaky-value" },
        },
      },
    }), "utf-8")

    const discovery = new CapabilityDiscoveryService({ homeDir, dataDir })
    const trust = new McpTrustService({ dataDir })
    await trust.initialize()
    const mcpRuntime = new McpRuntimeService({
      discoveryService: discovery,
      trustService: trust,
      clientFactory: () => ({
        async connect() {
          throw new Error(`failed at ${workspace.rootPath} token=sk-leaky-value`)
        },
        async listTools() {
          return { tools: [] }
        },
        async callTool() {
          return {}
        },
      }),
    })

    const status = await mcpRuntime.ensureWorkspaceStatus({ workspace })
    expect(status.summary).toMatchObject({
      enabledCount: 1,
      connectedCount: 0,
      errorCount: 1,
      toolCount: 0,
    })
    expect(status.servers[0]?.status).toBe("error")
    expect(status.servers[0]?.latestError).toContain("[REDACTED]")
    expect(JSON.stringify(status)).not.toContain(workspace.rootPath)
    expect(JSON.stringify(status)).not.toContain("sk-leaky-value")
    expect(mcpRuntime.getStatus().details.latestError).not.toContain("sk-leaky-value")
  })

  test("dynamic MCP tools are only exposed to primary ai-sdk agents and orchestrator", async () => {
    const { homeDir, dataDir, workspace } = await createTempWorkspace("agent-runtime-mcp-runtime-eligibility-")
    await writeFile(join(workspace.rootPath, "opencode.json"), JSON.stringify({
      mcp: {
        docs: {
          type: "local",
          command: ["node", "docs-server.js"],
        },
      },
    }), "utf-8")

    const discovery = new CapabilityDiscoveryService({ homeDir, dataDir })
    const trust = new McpTrustService({ dataDir })
    await trust.initialize()
    const mcpRuntime = new McpRuntimeService({
      discoveryService: discovery,
      trustService: trust,
      clientFactory: createFakeClientFactory().factory,
    })
    const mcpContext = await mcpRuntime.resolveWorkspaceMcpContext({ workspace })
    const registry = new RuntimeToolRegistry()

    const primary = await registry.buildAiSdkToolSettings(fakeContext({ mcpContext }))
    expect(primary?.activeTools).toEqual(["mcp_docs_search"])

    const orchestrator = await registry.buildAiSdkToolSettings(fakeContext({
      agent: fakeAgent({ id: "orchestrator", executorType: "orchestrator" }),
      mcpContext,
    }), { includeInternal: true })
    expect(orchestrator?.activeTools).toEqual(["mcp_docs_search"])

    const subagent = await registry.buildAiSdkToolSettings(fakeContext({
      agent: fakeAgent({ id: "researcher", tier: "subagent", visibility: "hidden" }),
      mcpContext,
    }))
    expect(subagent).toBeNull()

    const external = await registry.buildAiSdkToolSettings(fakeContext({
      agent: fakeAgent({ id: "codex", executorType: "external-adapter" }),
      mcpContext,
    }))
    expect(external).toBeNull()
  })

  test("status supports HTTP and SSE runtime configs through the client factory", async () => {
    const { homeDir, dataDir, workspace } = await createTempWorkspace("agent-runtime-mcp-runtime-transports-")
    await writeFile(join(workspace.rootPath, "mcp.json"), JSON.stringify({
      mcpServers: {
        remote_http: {
          transport: "http",
          url: "https://example.test/mcp",
          headers: { Authorization: "Bearer secret" },
        },
        remote_sse: {
          transport: "sse",
          url: "https://example.test/sse",
          headers: { "x-api-key": "secret" },
        },
      },
    }), "utf-8")

    const calls: McpServerRuntimeConfig[] = []
    const discovery = new CapabilityDiscoveryService({ homeDir, dataDir })
    const trust = new McpTrustService({ dataDir })
    await trust.initialize()
    const mcpRuntime = new McpRuntimeService({
      discoveryService: discovery,
      trustService: trust,
      clientFactory: (config) => {
        calls.push(config)
        return createFakeClientFactory().factory(config)
      },
    })

    const status = await mcpRuntime.ensureWorkspaceStatus({ workspace })
    expect(status.summary.connectedCount).toBe(2)
    expect(status.servers.map((server) => server.transport).sort()).toEqual(["http", "sse"])
    expect(calls.map((config) => config.transport).sort()).toEqual(["http", "sse"])
    expect(calls[0]?.headers ?? calls[1]?.headers).toBeDefined()
    expect(JSON.stringify(status)).not.toContain("Bearer secret")
    expect(JSON.stringify(status)).not.toContain("x-api-key")
  })

  test("trust store and API-safe status do not persist rootPath or secrets", async () => {
    const { homeDir, dataDir, workspace } = await createTempWorkspace("agent-runtime-mcp-runtime-redaction-")
    await writeFile(join(workspace.rootPath, "opencode.json"), JSON.stringify({
      mcp: {
        docs: {
          type: "local",
          command: ["node", "docs-server.js"],
          env: { TOKEN: "sk-leaky-value" },
        },
      },
    }), "utf-8")

    const discovery = new CapabilityDiscoveryService({ homeDir, dataDir })
    const [config] = await discovery.listMcpRuntimeConfigs({ scope: "workspace", workspace, sources: ["opencode"] })
    const trust = new McpTrustService({ dataDir })
    await trust.initialize()
    await trust.decide({ scope: "workspace", workspace, mcpRef: config.id, trusted: false })

    const store = await readFile(join(dataDir, "mcp-trust.json"), "utf-8")
    expect(store).not.toContain(workspace.rootPath)
    expect(store).not.toContain("sk-leaky-value")
  })
})
