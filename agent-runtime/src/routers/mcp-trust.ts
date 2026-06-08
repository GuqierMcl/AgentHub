import { Hono, type Context } from "hono"
import {
  McpTrustDecisionRequestSchema,
  McpTrustError,
  McpTrustListRequestSchema,
  McpTrustService,
} from "../runtime"

declare module "hono" {
  interface ContextVariableMap {
    mcpTrustService: McpTrustService
  }
}

export const mcpTrustRouter = new Hono()

mcpTrustRouter.post("/runtime/mcp-trust/query", async (c: Context) => {
  const body = await c.req.json().catch(() => null)
  const parsed = McpTrustListRequestSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return c.json({
      error: {
        code: "MCP_TRUST_INVALID_INPUT",
        message: "Invalid MCP trust query.",
        details: parsed.error.issues,
      },
    }, 400)
  }

  try {
    return c.json(await c.get("mcpTrustService").list(parsed.data))
  } catch (error) {
    return handleMcpTrustError(c, error)
  }
})

mcpTrustRouter.put("/runtime/mcp-trust", async (c: Context) => {
  const body = await c.req.json().catch(() => null)
  const parsed = McpTrustDecisionRequestSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return c.json({
      error: {
        code: "MCP_TRUST_INVALID_INPUT",
        message: "Invalid MCP trust decision.",
        details: parsed.error.issues,
      },
    }, 400)
  }

  try {
    return c.json(await c.get("mcpTrustService").decide(parsed.data))
  } catch (error) {
    return handleMcpTrustError(c, error)
  }
})

function handleMcpTrustError(c: Context, error: unknown): Response {
  if (error instanceof McpTrustError) {
    return c.json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    }, error.status as 400 | 500)
  }
  throw error
}

export default mcpTrustRouter
