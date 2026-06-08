import type { ManagedOpenCodeServer } from "./external-adapters"
import { getClaudeCodeReadiness, getCodexReadiness } from "./external-adapters"
import type { CapabilityDiscoveryStatusItem } from "./capabilities"
import type { McpRuntimeServiceStatusItem } from "./mcp-runtime"

export type RuntimeServiceStatus =
  | "running"
  | "starting"
  | "idle"
  | "error"
  | "not_integrated"
  | "refreshing"

export type RuntimeExternalServiceId = "opencode" | "codex" | "claude-code"

export type RuntimeExternalServiceStatusItem = {
  id: "opencode" | "codex" | "claude-code"
  label: string
  kind: "external-agent"
  status: RuntimeServiceStatus
  implemented: boolean
  checkedAt: string
  activeWorkspaceCount?: number
  pendingWorkspaceCount?: number
  details?: Record<string, unknown>
}

export type RuntimeServiceStatusItem =
  | RuntimeExternalServiceStatusItem
  | CapabilityDiscoveryStatusItem
  | McpRuntimeServiceStatusItem

export type RuntimeServicesStatusResponse = {
  checkedAt: string
  services: RuntimeServiceStatusItem[]
}

export type ExternalAgentRunSummary = {
  activeRunCount: number
  latestError?: string
}

export type ExternalAgentRunSummarySource = {
  getExternalAgentRunSummary(agentId: RuntimeExternalServiceId): ExternalAgentRunSummary
}

export type RuntimeServicesStatusContext = {
  externalAgents?: Partial<Record<RuntimeExternalServiceId, ExternalAgentRunSummary>>
  capabilityDiscovery?: CapabilityDiscoveryStatusItem
  mcpRuntime?: McpRuntimeServiceStatusItem
}

export function createRuntimeServicesStatus(
  openCodeServer: Pick<ManagedOpenCodeServer, "getStatus">,
  context: RuntimeServicesStatusContext = {}
): RuntimeServicesStatusResponse {
  const checkedAt = new Date().toISOString()
  return {
    checkedAt,
    services: [
      createOpenCodeServiceStatus(openCodeServer, checkedAt),
      createCodexServiceStatus(checkedAt, context.externalAgents?.codex),
      createClaudeCodeServiceStatus(checkedAt, context.externalAgents?.["claude-code"]),
      context.capabilityDiscovery ?? createDefaultCapabilityDiscoveryStatus(checkedAt),
      context.mcpRuntime ?? createDefaultMcpRuntimeStatus(checkedAt),
    ],
  }
}

function createOpenCodeServiceStatus(
  openCodeServer: Pick<ManagedOpenCodeServer, "getStatus">,
  checkedAt: string
): RuntimeExternalServiceStatusItem {
  const status = openCodeServer.getStatus()
  return {
    id: "opencode",
    label: "OpenCode",
    kind: "external-agent",
    status: status.status,
    implemented: true,
    checkedAt,
    activeWorkspaceCount: status.activeWorkspaceCount,
    pendingWorkspaceCount: status.pendingWorkspaceCount,
    details: {
      mode: status.mode,
      ...(status.lastError ? { lastError: status.lastError } : {}),
    },
  }
}
function createCodexServiceStatus(
  checkedAt: string,
  runSummary?: ExternalAgentRunSummary
): RuntimeExternalServiceStatusItem {
  const readiness = getCodexReadiness()
  const activeRunCount = runSummary?.activeRunCount ?? 0
  return {
    id: "codex",
    label: "Codex",
    kind: "external-agent",
    status: readiness.available
      ? activeRunCount > 0 ? "running" : "idle"
      : "error",
    implemented: true,
    checkedAt,
    details: {
      clientMode: readiness.clientMode,
      ...(readiness.version ? { version: readiness.version } : {}),
      ...(runSummary ? { activeRunCount } : {}),
      ...(runSummary?.latestError ? { latestError: runSummary.latestError } : {}),
      ...(readiness.error ? { lastError: readiness.error } : {}),
    },
  }
}

function createClaudeCodeServiceStatus(
  checkedAt: string,
  runSummary?: ExternalAgentRunSummary
): RuntimeExternalServiceStatusItem {
  const readiness = getClaudeCodeReadiness()
  const activeRunCount = runSummary?.activeRunCount ?? 0
  return {
    id: "claude-code",
    label: "Claude Code",
    kind: "external-agent",
    status: readiness.available
      ? activeRunCount > 0 ? "running" : "idle"
      : "error",
    implemented: true,
    checkedAt,
    details: {
      executableSource: readiness.executableSource,
      ...(runSummary ? { activeRunCount } : {}),
      ...(runSummary?.latestError ? { latestError: runSummary.latestError } : {}),
      ...(readiness.executablePath ? { executablePath: readiness.executablePath } : {}),
    },
  }
}

function createDefaultCapabilityDiscoveryStatus(checkedAt: string): CapabilityDiscoveryStatusItem {
  return {
    id: "capability-discovery",
    label: "Capability Discovery",
    kind: "runtime-capability",
    status: "idle",
    implemented: true,
    checkedAt,
    details: {
      cacheEntryCount: 0,
    },
  }
}

function createDefaultMcpRuntimeStatus(checkedAt: string): McpRuntimeServiceStatusItem {
  return {
    id: "mcp-runtime",
    label: "MCP Runtime",
    kind: "runtime-capability",
    status: "idle",
    implemented: true,
    checkedAt,
    details: {
      trustedRecordCount: 0,
      clientCount: 0,
      connectedServerCount: 0,
      errorServerCount: 0,
      toolCount: 0,
    },
  }
}
