import { Hono, type Context } from "hono"
import {
  WorkspaceRevertRequestSchema,
  WorkspaceRevertService,
} from "../runtime"

declare module "hono" {
  interface ContextVariableMap {
    workspaceRevertService: WorkspaceRevertService
  }
}

const workspaceRevert = new Hono()

function invalidInput(c: Context, details: unknown) {
  return c.json({
    error: {
      code: "WORKSPACE_REVERT_INVALID_INPUT",
      message: "Invalid workspace revert input",
      details,
    },
  }, 400)
}

workspaceRevert.post("/runtime/workspace/revert/preview", async (c: Context) => {
  const body = await c.req.json().catch(() => null)
  const parsed = WorkspaceRevertRequestSchema.safeParse(body)
  if (!parsed.success) {
    return invalidInput(c, parsed.error.issues)
  }

  return c.json(await c.get("workspaceRevertService").preview(parsed.data))
})

workspaceRevert.post("/runtime/workspace/revert/apply", async (c: Context) => {
  const body = await c.req.json().catch(() => null)
  const parsed = WorkspaceRevertRequestSchema.safeParse(body)
  if (!parsed.success) {
    return invalidInput(c, parsed.error.issues)
  }

  return c.json(await c.get("workspaceRevertService").apply(parsed.data))
})

export default workspaceRevert
