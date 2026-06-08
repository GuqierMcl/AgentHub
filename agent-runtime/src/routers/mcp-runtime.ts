import { Hono, type Context } from "hono"
import {
  McpRuntimeError,
  McpRuntimeService,
  McpWorkspaceStatusRequestSchema,
} from "../runtime"

declare module "hono" {
  interface ContextVariableMap {
    mcpRuntimeService: McpRuntimeService
  }
}

export const mcpRuntimeRouter = new Hono()

mcpRuntimeRouter.post("/runtime/mcp/workspace/status", async (c: Context) => {
  const body = await c.req.json().catch(() => undefined)
  if (body === undefined) {
    return c.json({
      error: {
        code: "MCP_RUNTIME_INVALID_INPUT",
        message: "Invalid MCP workspace status request.",
      },
    }, 400)
  }

  const parsed = McpWorkspaceStatusRequestSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return c.json({
      error: {
        code: "MCP_RUNTIME_INVALID_INPUT",
        message: "Invalid MCP workspace status request.",
        details: parsed.error.issues,
      },
    }, 400)
  }
  if (!parsed.data.workspace) {
    return c.json({
      error: {
        code: "MCP_RUNTIME_WORKSPACE_REQUIRED",
        message: "Workspace MCP status requires a workspace snapshot.",
      },
    }, 400)
  }

  try {
    return c.json(await c.get("mcpRuntimeService").ensureWorkspaceStatus(parsed.data))
  } catch (error) {
    return handleMcpRuntimeError(c, error)
  }
})

function handleMcpRuntimeError(c: Context, error: unknown): Response {
  if (error instanceof McpRuntimeError) {
    return c.json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    }, error.status as 400 | 404 | 500)
  }
  throw error
}

export default mcpRuntimeRouter
