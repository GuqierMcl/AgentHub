import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { createHash } from "node:crypto"
import { z } from "zod"
import type { JSONSchema7 } from "ai"
import type {
  CapabilityDiscoveryService,
  CapabilitySource,
  McpServerRuntimeConfig,
  McpTransport,
} from "./capabilities"
import {
  McpTrustService,
  McpTrustWorkspaceSchema,
  hashMcpTrustWorkspaceRoot,
  type McpTrustWorkspace,
} from "./mcp-trust"
import type { ToolDefinition, ToolExecutionResult } from "./tools"

export const McpWorkspaceStatusRequestSchema = z.object({
  workspace: McpTrustWorkspaceSchema.optional(),
  connect: z.boolean().default(true),
}).strict()

export type McpWorkspaceStatusRequest = z.input<typeof McpWorkspaceStatusRequestSchema>

export type McpRuntimeServerStatus =
  | "discovered"
  | "connecting"
  | "connected"
  | "disabled"
  | "error"

export type McpWorkspaceStatusServer = {
  id: string
  name: string
  source: CapabilitySource
  sources: CapabilitySource[]
  duplicateCount: number
  transport?: McpTransport
  status: McpRuntimeServerStatus
  enabled: boolean
  trusted: boolean
  toolCount: number
  latestError?: string
}

export type McpWorkspaceStatusResponse = {
  checkedAt: string
  workspace: {
    workspaceId: string
    backendType: "local"
    workspaceRootHash: string
  }
  summary: {
    serverCount: number
    enabledCount: number
    connectedCount: number
    errorCount: number
    toolCount: number
  }
  servers: McpWorkspaceStatusServer[]
}

export type McpRuntimeServiceStatusItem = {
  id: "mcp-runtime"
  label: "MCP Runtime"
  kind: "runtime-capability"
  status: "idle" | "running" | "error"
  implemented: true
  checkedAt: string
  details: {
    trustedRecordCount: number
    clientCount: number
    connectedServerCount: number
    errorServerCount: number
    toolCount: number
    latestRefreshAt?: string
    latestError?: string
  }
}

export type McpRuntimeToolMetadata = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export type McpRuntimeClient = {
  connect(): Promise<void>
  listTools(): Promise<{ tools: McpRuntimeToolMetadata[] }>
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>
  close?(): Promise<void>
}

export type McpRuntimeClientFactory = (config: McpServerRuntimeConfig) => McpRuntimeClient

export type McpRuntimeContextServer = {
  id: string
  name: string
  source: CapabilitySource
  transport?: McpTransport
  status: McpRuntimeServerStatus
  toolCount: number
}

export type McpRuntimeContextTool = {
  toolName: string
  serverId: string
  serverName: string
  mcpToolName: string
  description?: string
}

export type McpRuntimeContext = {
  servers: McpRuntimeContextServer[]
  tools: McpRuntimeContextTool[]
  toolDefinitions: ToolDefinition[]
}

export type McpRuntimeServiceOptions = {
  discoveryService: CapabilityDiscoveryService
  trustService: McpTrustService
  clientFactory?: McpRuntimeClientFactory
}

type RuntimeClientEntry = {
  workspace: McpTrustWorkspace
  workspaceRootHash: string
  config: McpServerRuntimeConfig
  status: McpRuntimeServerStatus
  trusted: boolean
  enabled: boolean
  client?: McpRuntimeClient
  tools: RuntimeMcpTool[]
  latestError?: string
}

type RuntimeMcpTool = McpRuntimeToolMetadata & {
  runtimeName: string
}

type EffectiveMcpCandidate = {
  config: McpServerRuntimeConfig
  trusted: boolean
  enabled: boolean
}

type EffectiveMcpGroup = {
  key: string
  candidates: EffectiveMcpCandidate[]
  sources: CapabilitySource[]
  duplicateCount: number
}

const RuntimeMcpToolInputSchema = z.record(z.string(), z.unknown()).default({})

export class McpRuntimeError extends Error {
  constructor(
    public code:
      | "MCP_RUNTIME_INVALID_INPUT"
      | "MCP_RUNTIME_WORKSPACE_REQUIRED"
      | "MCP_RUNTIME_SERVER_NOT_FOUND"
      | "MCP_RUNTIME_TOOL_NOT_FOUND"
      | "MCP_RUNTIME_CONNECT_FAILED"
      | "MCP_RUNTIME_TOOL_CALL_FAILED",
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message)
    this.name = "McpRuntimeError"
  }
}

export class McpRuntimeService {
  private entries = new Map<string, RuntimeClientEntry>()
  private latestRefreshAt?: string
  private latestError?: string

  constructor(private options: McpRuntimeServiceOptions) {}

  async ensureWorkspaceStatus(input: McpWorkspaceStatusRequest): Promise<McpWorkspaceStatusResponse> {
    const request = parseWorkspaceStatusRequest(input)
    const workspace = request.workspace
    const workspaceRootHash = hashMcpTrustWorkspaceRoot(workspace.rootPath)
    const configs = await this.options.discoveryService.listMcpRuntimeConfigs({
      scope: "workspace",
      workspace,
    })

    const servers: McpWorkspaceStatusServer[] = []
    const groups = await this.resolveEffectiveGroups(
      workspace,
      configs.filter((candidate) => candidate.level === "workspace")
    )

    for (const group of groups) {
      const trustedCandidates = group.candidates.filter((candidate) => candidate.trusted)
      if (trustedCandidates.length === 0) {
        const candidate = group.candidates[0]
        if (!candidate) continue
        const entry = this.createOrUpdateEntry(workspace, workspaceRootHash, candidate.config, {
          status: "disabled",
          trusted: false,
          enabled: false,
          tools: [],
          latestError: undefined,
        })
        this.removeDuplicateEntries(workspaceRootHash, group, entry.config.id)
        servers.push(this.toStatusServer(entry, group))
        continue
      }

      if (!request.connect) {
        const candidate = selectStatusCandidate(trustedCandidates, this.entries, workspaceRootHash)
        const existing = this.entries.get(createEntryKey(workspaceRootHash, candidate.config.id))
        const entry = this.createOrUpdateEntry(workspace, workspaceRootHash, candidate.config, {
          status: existing?.status ?? "discovered",
          trusted: candidate.trusted,
          enabled: candidate.enabled,
          client: existing?.client,
          tools: existing?.tools ?? [],
          latestError: existing?.latestError,
        })
        this.removeDuplicateEntries(workspaceRootHash, group, entry.config.id)
        servers.push(this.toStatusServer(entry, group))
        continue
      }

      let selectedEntry: RuntimeClientEntry | undefined
      let lastEntry: RuntimeClientEntry | undefined
      for (const candidate of trustedCandidates) {
        const entry = await this.ensureConnected(
          workspace,
          workspaceRootHash,
          candidate.config,
          candidate.trusted,
          candidate.enabled
        )
        lastEntry = entry
        if (entry.status === "connected") {
          selectedEntry = entry
          break
        }
      }
      const entry = selectedEntry ?? lastEntry
      if (!entry) continue
      this.removeDuplicateEntries(workspaceRootHash, group, entry.config.id)
      servers.push(this.toStatusServer(entry, group))
    }

    this.latestRefreshAt = new Date().toISOString()
    this.latestError = servers.find((server) => server.status === "error")?.latestError

    return {
      checkedAt: new Date().toISOString(),
      workspace: {
        workspaceId: workspace.workspaceId,
        backendType: "local",
        workspaceRootHash,
      },
      summary: {
        serverCount: servers.length,
        enabledCount: servers.filter((server) => server.enabled).length,
        connectedCount: servers.filter((server) => server.status === "connected").length,
        errorCount: servers.filter((server) => server.status === "error").length,
        toolCount: servers.reduce((sum, server) => sum + server.toolCount, 0),
      },
      servers: sortServers(servers),
    }
  }

  async resolveWorkspaceMcpContext(input: { workspace?: McpTrustWorkspace }): Promise<McpRuntimeContext> {
    if (!input.workspace) {
      return { servers: [], tools: [], toolDefinitions: [] }
    }

    const status = await this.ensureWorkspaceStatus({
      workspace: input.workspace,
      connect: true,
    })
    const workspaceRootHash = status.workspace.workspaceRootHash
    const connectedServerIds = new Set(
      status.servers
        .filter((server) => server.status === "connected")
        .map((server) => server.id)
    )
    const connectedEntries = Array.from(this.entries.values())
      .filter((entry) =>
        entry.workspaceRootHash === workspaceRootHash &&
        entry.status === "connected" &&
        entry.enabled &&
        entry.trusted &&
        connectedServerIds.has(entry.config.id)
      )
      .sort((left, right) => left.config.name.localeCompare(right.config.name))

    return {
      servers: connectedEntries.map((entry) => ({
        id: entry.config.id,
        name: entry.config.name,
        source: entry.config.source,
        transport: entry.config.transport,
        status: entry.status,
        toolCount: entry.tools.length,
      })),
      tools: connectedEntries.flatMap((entry) => entry.tools.map((mcpTool) => ({
        toolName: mcpTool.runtimeName,
        serverId: entry.config.id,
        serverName: entry.config.name,
        mcpToolName: mcpTool.name,
        ...(mcpTool.description ? { description: mcpTool.description } : {}),
      }))),
      toolDefinitions: connectedEntries.flatMap((entry) => this.createToolDefinitions(input.workspace!, entry)),
    }
  }

  getStatus(trustedRecordCount = this.options.trustService.getStatus().details.trustedRecordCount): McpRuntimeServiceStatusItem {
    const entries = Array.from(this.entries.values())
    const connectedServerCount = entries.filter((entry) => entry.status === "connected").length
    const errorServerCount = entries.filter((entry) => entry.status === "error").length
    const toolCount = entries.reduce((sum, entry) => sum + entry.tools.length, 0)
    return {
      id: "mcp-runtime",
      label: "MCP Runtime",
      kind: "runtime-capability",
      status: this.latestError ? "error" : connectedServerCount > 0 ? "running" : "idle",
      implemented: true,
      checkedAt: new Date().toISOString(),
      details: {
        trustedRecordCount,
        clientCount: entries.filter((entry) => entry.client).length,
        connectedServerCount,
        errorServerCount,
        toolCount,
        ...(this.latestRefreshAt ? { latestRefreshAt: this.latestRefreshAt } : {}),
        ...(this.latestError ? { latestError: this.latestError } : {}),
      },
    }
  }

  private async resolveEffectiveGroups(
    workspace: McpTrustWorkspace,
    configs: McpServerRuntimeConfig[],
  ): Promise<EffectiveMcpGroup[]> {
    const groups = new Map<string, EffectiveMcpCandidate[]>()
    for (const config of configs) {
      const trusted = await this.options.trustService.isTrusted({
        scope: "workspace",
        workspace,
        mcpRef: config.id,
      })
      const key = createLogicalMcpKey(config)
      const candidates = groups.get(key) ?? []
      candidates.push({
        config,
        trusted,
        enabled: trusted,
      })
      groups.set(key, candidates)
    }

    return Array.from(groups.entries())
      .map(([key, candidates]) => {
        const ordered = candidates.sort(compareEffectiveMcpCandidates)
        return {
          key,
          candidates: ordered,
          sources: uniqueSources(ordered.map((candidate) => candidate.config.source)),
          duplicateCount: ordered.length,
        }
      })
      .sort((left, right) => left.key.localeCompare(right.key))
  }

  private removeDuplicateEntries(workspaceRootHash: string, group: EffectiveMcpGroup, keepServerId: string): void {
    for (const candidate of group.candidates) {
      if (candidate.config.id !== keepServerId) {
        this.entries.delete(createEntryKey(workspaceRootHash, candidate.config.id))
      }
    }
  }

  private async ensureConnected(
    workspace: McpTrustWorkspace,
    workspaceRootHash: string,
    config: McpServerRuntimeConfig,
    trusted: boolean,
    enabled: boolean,
  ): Promise<RuntimeClientEntry> {
    const existing = this.entries.get(createEntryKey(workspaceRootHash, config.id))
    if (existing?.status === "connected" && existing.client) {
      existing.trusted = trusted
      existing.enabled = enabled
      return existing
    }

    if (!isConnectableConfig(config)) {
      const latestError = sanitizeStatusError(config.warnings[0] ?? "MCP server config is not connectable.")
      this.latestError = latestError
      return this.createOrUpdateEntry(workspace, workspaceRootHash, config, {
        status: "error",
        trusted,
        enabled,
        tools: [],
        latestError,
      })
    }

    const connecting = this.createOrUpdateEntry(workspace, workspaceRootHash, config, {
      status: "connecting",
      trusted,
      enabled,
      tools: [],
      latestError: undefined,
    })

    try {
      const client = this.createClient(config)
      await client.connect()
      const listed = await client.listTools()
      const tools = assignRuntimeToolNames(config, listed.tools ?? [])
      connecting.client = client
      connecting.status = "connected"
      connecting.tools = tools
      connecting.latestError = undefined
      this.latestError = undefined
      return connecting
    } catch (error) {
      const latestError = sanitizeStatusError(error instanceof Error ? error.message : String(error))
      connecting.status = "error"
      connecting.client = undefined
      connecting.tools = []
      connecting.latestError = latestError
      this.latestError = latestError
      return connecting
    }
  }

  private createClient(config: McpServerRuntimeConfig): McpRuntimeClient {
    return this.options.clientFactory
      ? this.options.clientFactory(config)
      : createDefaultMcpRuntimeClient(config)
  }

  private createOrUpdateEntry(
    workspace: McpTrustWorkspace,
    workspaceRootHash: string,
    config: McpServerRuntimeConfig,
    updates: {
      status: McpRuntimeServerStatus
      trusted: boolean
      enabled: boolean
      client?: McpRuntimeClient
      tools: RuntimeMcpTool[]
      latestError?: string
    },
  ): RuntimeClientEntry {
    const key = createEntryKey(workspaceRootHash, config.id)
    const entry = this.entries.get(key) ?? {
      workspace,
      workspaceRootHash,
      config,
      status: updates.status,
      trusted: updates.trusted,
      enabled: updates.enabled,
      tools: [],
    }
    entry.workspace = workspace
    entry.workspaceRootHash = workspaceRootHash
    entry.config = config
    entry.status = updates.status
    entry.trusted = updates.trusted
    entry.enabled = updates.enabled
    entry.client = updates.client
    entry.tools = updates.tools
    entry.latestError = updates.latestError
    this.entries.set(key, entry)
    return entry
  }

  private toStatusServer(entry: RuntimeClientEntry, group: EffectiveMcpGroup): McpWorkspaceStatusServer {
    return {
      id: entry.config.id,
      name: entry.config.name,
      source: entry.config.source,
      sources: group.sources,
      duplicateCount: group.duplicateCount,
      ...(entry.config.transport ? { transport: entry.config.transport } : {}),
      status: entry.status,
      enabled: entry.enabled,
      trusted: entry.trusted,
      toolCount: entry.tools.length,
      ...(entry.latestError ? { latestError: entry.latestError } : {}),
    }
  }

  private createToolDefinitions(
    workspace: McpTrustWorkspace,
    entry: RuntimeClientEntry,
  ): ToolDefinition[] {
    return entry.tools.map((mcpTool) => ({
      name: mcpTool.runtimeName,
      displayName: `${entry.config.name}: ${mcpTool.name}`,
      description: mcpTool.description ?? `Call MCP tool ${mcpTool.name} on server ${entry.config.name}.`,
      category: "mcp",
      inputSchema: RuntimeMcpToolInputSchema,
      modelInputJsonSchema: normalizeJsonSchema(mcpTool.inputSchema),
      riskLevel: "medium",
      requiredPermissions: {},
      approvalPolicy: "never",
      configurableByUserAgent: false,
      eventData: {
        externalProvider: "mcp",
        serverId: entry.config.id,
        serverName: entry.config.name,
        source: entry.config.source,
        transport: entry.config.transport ?? "unknown",
        mcpToolName: mcpTool.name,
      },
      async execute(input): Promise<ToolExecutionResult> {
        const result = await callMcpRuntimeTool(entry, workspace, mcpTool.name, toRecordInput(input))
        return {
          status: "completed",
          summary: `MCP tool ${mcpTool.name} completed on ${entry.config.name}.`,
          data: {
            externalProvider: "mcp",
            serverId: entry.config.id,
            serverName: entry.config.name,
            source: entry.config.source,
            transport: entry.config.transport ?? "unknown",
            toolName: mcpTool.name,
            result,
          },
        }
      },
    }))
  }
}

export function formatMcpContextForPrompt(context?: McpRuntimeContext): string {
  if (!context || context.tools.length === 0) {
    return ""
  }

  const serverLines = context.servers
    .filter((server) => server.status === "connected")
    .map((server) => `- ${server.name} (${server.source}, ${server.transport ?? "unknown"}): ${server.toolCount} tools`)
  const toolLines = context.tools
    .map((item) => [
      `- ${item.toolName}`,
      `server: ${item.serverName}`,
      `mcp tool: ${item.mcpToolName}`,
      item.description ? `description: ${item.description}` : undefined,
    ].filter(Boolean).join(" | "))

  return [
    "Workspace MCP tools are available for this run.",
    "Use these tools when they directly help answer the user's request.",
    "Connected MCP servers:",
    ...serverLines,
    "Available Workspace MCP tools:",
    ...toolLines,
  ].join("\n")
}

function parseWorkspaceStatusRequest(input: McpWorkspaceStatusRequest): { workspace: McpTrustWorkspace; connect: boolean } {
  const parsed = McpWorkspaceStatusRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new McpRuntimeError(
      "MCP_RUNTIME_INVALID_INPUT",
      "Invalid MCP workspace status request.",
      400,
      parsed.error.issues,
    )
  }
  if (!parsed.data.workspace) {
    throw new McpRuntimeError(
      "MCP_RUNTIME_WORKSPACE_REQUIRED",
      "Workspace MCP status requires a workspace snapshot.",
      400,
    )
  }
  return {
    workspace: parsed.data.workspace,
    connect: parsed.data.connect,
  }
}

function createLogicalMcpKey(config: McpServerRuntimeConfig): string {
  return `${config.level}:${normalizeLogicalName(config.name)}`
}

function selectStatusCandidate(
  candidates: EffectiveMcpCandidate[],
  entries: Map<string, RuntimeClientEntry>,
  workspaceRootHash: string,
): EffectiveMcpCandidate {
  return candidates.find((candidate) =>
    entries.get(createEntryKey(workspaceRootHash, candidate.config.id))?.status === "connected"
  ) ?? candidates[0]!
}

function compareEffectiveMcpCandidates(left: EffectiveMcpCandidate, right: EffectiveMcpCandidate): number {
  return compareSources(left.config.source, right.config.source) ||
    left.config.id.localeCompare(right.config.id)
}

function uniqueSources(sources: CapabilitySource[]): CapabilitySource[] {
  const seen = new Set<CapabilitySource>()
  const result: CapabilitySource[] = []
  for (const source of [...sources].sort(compareSources)) {
    if (!seen.has(source)) {
      seen.add(source)
      result.push(source)
    }
  }
  return result
}

function createEntryKey(workspaceRootHash: string, serverId: string): string {
  return `${workspaceRootHash}:${serverId}`
}

function isConnectableConfig(config: McpServerRuntimeConfig): boolean {
  if (!config.valid) return false
  if (config.transport === "stdio") return Boolean(config.command)
  if (config.transport === "http" || config.transport === "sse") return Boolean(config.url)
  return false
}

function createDefaultMcpRuntimeClient(config: McpServerRuntimeConfig): McpRuntimeClient {
  const client = new Client({
    name: "agenthub-runtime",
    version: "0.1.0",
  })
  const transport = createTransport(config)
  return {
    async connect() {
      await client.connect(transport)
    },
    async listTools() {
      return client.listTools()
    },
    async callTool(params) {
      return client.callTool({
        name: params.name,
        arguments: params.arguments ?? {},
      })
    },
    async close() {
      await client.close()
    },
  }
}

function createTransport(config: McpServerRuntimeConfig) {
  if (config.transport === "stdio" && config.command) {
    return new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      ...(config.env ? { env: mergeProcessEnv(config.env) } : {}),
      ...(config.cwd ? { cwd: config.cwd } : {}),
      stderr: "pipe",
    })
  }

  if (config.transport === "sse" && config.url) {
    return new SSEClientTransport(new URL(config.url), {
      requestInit: {
        ...(config.headers ? { headers: config.headers } : {}),
      },
      eventSourceInit: config.headers
        ? { fetch: (url, init) => fetch(url, { ...init, headers: config.headers }) }
        : undefined,
    })
  }

  if (config.transport === "http" && config.url) {
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: {
        ...(config.headers ? { headers: config.headers } : {}),
      },
    })
  }

  throw new McpRuntimeError(
    "MCP_RUNTIME_CONNECT_FAILED",
    "MCP server config is not connectable.",
    400,
  )
}

function mergeProcessEnv(env: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      merged[key] = value
    }
  }
  return {
    ...merged,
    ...env,
  }
}

function toRecordInput(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

async function callMcpRuntimeTool(
  entry: RuntimeClientEntry,
  workspace: McpTrustWorkspace,
  toolName: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (!entry.client || entry.status !== "connected") {
    throw new McpRuntimeError(
      "MCP_RUNTIME_SERVER_NOT_FOUND",
      "MCP server is not connected.",
      404,
    )
  }

  try {
    const result = await entry.client.callTool({
      name: toolName,
      arguments: input,
    })
    return redactMcpValue(result, workspace.rootPath)
  } catch (error) {
    throw new McpRuntimeError(
      "MCP_RUNTIME_TOOL_CALL_FAILED",
      sanitizeStatusError(error instanceof Error ? error.message : String(error)),
      500,
    )
  }
}

function assignRuntimeToolNames(
  config: McpServerRuntimeConfig,
  tools: McpRuntimeToolMetadata[],
): RuntimeMcpTool[] {
  const used = new Set<string>()
  return tools.map((tool) => {
    const baseName = `mcp_${toSnake(config.name)}_${toSnake(tool.name)}`
    let runtimeName = baseName
    if (used.has(runtimeName)) {
      runtimeName = `${baseName}_${shortHash(`${config.id}:${tool.name}`)}`
    }
    used.add(runtimeName)
    return {
      ...tool,
      runtimeName,
    }
  })
}

function toSnake(value: string): string {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
  return normalized || "tool"
}

function normalizeLogicalName(value: string): string {
  return toSnake(value)
}

function compareSources(left: CapabilitySource, right: CapabilitySource): number {
  return sourcePriority(left) - sourcePriority(right)
}

function sourcePriority(source: CapabilitySource): number {
  switch (source) {
    case "agents":
      return 0
    case "codex":
      return 1
    case "claude-code":
      return 2
    case "opencode":
      return 3
  }
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8)
}

function normalizeJsonSchema(schema: Record<string, unknown> | undefined): JSONSchema7 {
  if (!schema || schema.type !== "object") {
    return { type: "object", properties: {}, required: [] }
  }
  return schema as JSONSchema7
}

function redactMcpValue(value: unknown, workspaceRoot: string): unknown {
  if (typeof value === "string") {
    return redactString(value, workspaceRoot)
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactMcpValue(item, workspaceRoot))
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        SECRET_KEY_PATTERN.test(key)
          ? "[REDACTED]"
          : redactMcpValue(inner, workspaceRoot),
      ])
    )
  }
  return value
}

function redactString(value: string, workspaceRoot: string): string {
  return sanitizeStatusError(value)
    .replaceAll(workspaceRoot, "[workspace-root]")
}

function sanitizeStatusError(message: string): string {
  return message
    .replace(/[A-Za-z]:\\[^\s"'`<>]+/g, "[REDACTED_PATH]")
    .replace(/(^|\s)\/(?:[^/\s"'`<>]+\/)+[^/\s"'`<>]*/g, "$1[REDACTED_PATH]")
    .replace(/(token|secret|password|passwd|api[-_]?key|authorization|credential)=([^\s&]+)/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/(sk-|ghp_|github_pat_|xox[baprs]-|ya29\.|eyJ)[A-Za-z0-9._-]{8,}/g, "[REDACTED]")
    .slice(0, 500)
}

function sortServers(servers: McpWorkspaceStatusServer[]): McpWorkspaceStatusServer[] {
  return [...servers].sort((left, right) => left.id.localeCompare(right.id))
}

const SECRET_KEY_PATTERN = /(token|secret|password|passwd|api[-_]?key|authorization|credential)/i
