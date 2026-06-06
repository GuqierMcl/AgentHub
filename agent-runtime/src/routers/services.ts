import { Hono, type Context } from "hono"
import {
  createRuntimeServicesStatus,
  getDefaultOpenCodeServer,
  type ExternalAgentRunSummarySource,
} from "../runtime"

export const servicesRouter = new Hono()

servicesRouter.get("/runtime/services/status", (c: Context) => {
  const runManager = c.get("runManager") as ExternalAgentRunSummarySource | undefined
  return c.json(createRuntimeServicesStatus(getDefaultOpenCodeServer(), {
    externalAgents: {
      codex: runManager?.getExternalAgentRunSummary("codex"),
      "claude-code": runManager?.getExternalAgentRunSummary("claude-code"),
    },
  }))
})

export default servicesRouter
