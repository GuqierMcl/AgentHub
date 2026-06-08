import { Hono, type Context } from "hono"
import {
  createRuntimeServicesStatus,
  getDefaultOpenCodeServer,
  type CapabilityDiscoveryService,
  type ExternalAgentRunSummarySource,
  type McpRuntimeService,
  type McpTrustService,
} from "../runtime"

export const servicesRouter = new Hono()

servicesRouter.get("/runtime/services/status", (c: Context) => {
  const runManager = c.get("runManager") as ExternalAgentRunSummarySource | undefined
  const capabilityDiscoveryService = c.get("capabilityDiscoveryService") as CapabilityDiscoveryService | undefined
  const mcpRuntimeService = c.get("mcpRuntimeService") as McpRuntimeService | undefined
  const mcpTrustService = c.get("mcpTrustService") as McpTrustService | undefined
  const mcpTrustStatus = mcpTrustService?.getStatus()
  return c.json(createRuntimeServicesStatus(getDefaultOpenCodeServer(), {
    externalAgents: {
      codex: runManager?.getExternalAgentRunSummary("codex"),
      "claude-code": runManager?.getExternalAgentRunSummary("claude-code"),
    },
    capabilityDiscovery: capabilityDiscoveryService?.getStatus(),
    mcpRuntime: mcpRuntimeService?.getStatus(mcpTrustStatus?.details.trustedRecordCount)
      ?? (mcpTrustStatus
        ? {
            ...mcpTrustStatus,
            details: {
              trustedRecordCount: mcpTrustStatus.details.trustedRecordCount,
              clientCount: 0,
              connectedServerCount: 0,
              errorServerCount: 0,
              toolCount: 0,
              ...(mcpTrustStatus.details.latestError ? { latestError: mcpTrustStatus.details.latestError } : {}),
            },
          }
        : undefined),
  }))
})

export default servicesRouter
