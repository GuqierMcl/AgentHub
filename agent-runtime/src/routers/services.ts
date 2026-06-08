import { Hono, type Context } from "hono"
import {
  createRuntimeServicesStatus,
  getDefaultOpenCodeServer,
  type CapabilityDiscoveryService,
  type ExternalAgentRunSummarySource,
  type McpTrustService,
} from "../runtime"

export const servicesRouter = new Hono()

servicesRouter.get("/runtime/services/status", (c: Context) => {
  const runManager = c.get("runManager") as ExternalAgentRunSummarySource | undefined
  const capabilityDiscoveryService = c.get("capabilityDiscoveryService") as CapabilityDiscoveryService | undefined
  const mcpTrustService = c.get("mcpTrustService") as McpTrustService | undefined
  return c.json(createRuntimeServicesStatus(getDefaultOpenCodeServer(), {
    externalAgents: {
      codex: runManager?.getExternalAgentRunSummary("codex"),
      "claude-code": runManager?.getExternalAgentRunSummary("claude-code"),
    },
    capabilityDiscovery: capabilityDiscoveryService?.getStatus(),
    mcpRuntime: mcpTrustService?.getStatus(),
  }))
})

export default servicesRouter
