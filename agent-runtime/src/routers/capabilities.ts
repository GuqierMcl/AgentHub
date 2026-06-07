import { Hono, type Context } from "hono"
import {
  CapabilityDiscoveryError,
  CapabilityDiscoveryRequestSchema,
  CapabilityDiscoveryService,
  CapabilityScopeSchema,
} from "../runtime/capabilities"

declare module "hono" {
  interface ContextVariableMap {
    capabilityDiscoveryService: CapabilityDiscoveryService
  }
}

export const capabilitiesRouter = new Hono()

capabilitiesRouter.get("/runtime/capabilities", async (c: Context) => {
  const requestedScope = c.req.query("scope")
  if (requestedScope === "workspace" || requestedScope === "all") {
    return c.json({
      error: {
        code: "CAPABILITY_WORKSPACE_REQUIRED",
        message: "Workspace capability discovery requires POST /runtime/capabilities/discover.",
      },
    }, 400)
  }

  if (requestedScope !== undefined && requestedScope !== "global") {
    return c.json({
      error: {
        code: "CAPABILITY_INVALID_INPUT",
        message: "GET /runtime/capabilities only supports scope=global.",
      },
    }, 400)
  }

  return c.json(await c.get("capabilityDiscoveryService").discover({ scope: "global" }))
})

capabilitiesRouter.post("/runtime/capabilities/discover", async (c: Context) => {
  const body = await c.req.json().catch(() => null)
  const result = CapabilityDiscoveryRequestSchema.safeParse(body ?? {})
  if (!result.success) {
    return c.json({
      error: {
        code: "CAPABILITY_INVALID_INPUT",
        message: "Invalid capability discovery request.",
        details: result.error.issues,
      },
    }, 400)
  }

  try {
    return c.json(await c.get("capabilityDiscoveryService").discover(result.data))
  } catch (error) {
    if (error instanceof CapabilityDiscoveryError) {
      return c.json({
        error: {
          code: error.code,
          message: error.message,
        },
      }, error.status as 400)
    }
    throw error
  }
})

capabilitiesRouter.post("/runtime/capabilities/refresh", async (c: Context) => {
  const body = await c.req.json().catch(() => null)
  const result = CapabilityDiscoveryRequestSchema.safeParse(body ?? {})
  if (!result.success) {
    return c.json({
      error: {
        code: "CAPABILITY_INVALID_INPUT",
        message: "Invalid capability refresh request.",
        details: result.error.issues,
      },
    }, 400)
  }

  try {
    return c.json(await c.get("capabilityDiscoveryService").refresh(result.data))
  } catch (error) {
    if (error instanceof CapabilityDiscoveryError) {
      return c.json({
        error: {
          code: error.code,
          message: error.message,
        },
      }, error.status as 400)
    }
    throw error
  }
})

capabilitiesRouter.get("/runtime/skills", async (c: Context) => {
  const scope = CapabilityScopeSchema.catch("global").parse(c.req.query("scope") ?? "global")
  if (scope !== "global") {
    return c.json({
      error: {
        code: "CAPABILITY_WORKSPACE_REQUIRED",
        message: "Workspace skill discovery requires POST /runtime/capabilities/discover.",
      },
    }, 400)
  }
  const response = await c.get("capabilityDiscoveryService").discover({ scope: "global" })
  return c.json({ discoveredAt: response.discoveredAt, scope: "global", skills: response.skills })
})

capabilitiesRouter.get("/runtime/mcp/servers", async (c: Context) => {
  const scope = CapabilityScopeSchema.catch("global").parse(c.req.query("scope") ?? "global")
  if (scope !== "global") {
    return c.json({
      error: {
        code: "CAPABILITY_WORKSPACE_REQUIRED",
        message: "Workspace MCP discovery requires POST /runtime/capabilities/discover.",
      },
    }, 400)
  }
  const response = await c.get("capabilityDiscoveryService").discover({ scope: "global" })
  return c.json({ discoveredAt: response.discoveredAt, scope: "global", mcps: response.mcps })
})

export default capabilitiesRouter
