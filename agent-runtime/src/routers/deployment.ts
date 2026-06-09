import { Hono, type Context } from "hono"
import { z } from "zod"
import type { RunManager } from "../runtime"

declare module "hono" {
  interface ContextVariableMap {
    runManager: RunManager
  }
}

const deployment = new Hono()

const CloseDeploymentConnectionSchema = z.object({
  reason: z.string().trim().min(1).max(1_000).optional(),
}).strict()

deployment.post("/runtime/deployments/connections/:connectionId/close", async (c: Context) => {
  const connectionId = c.req.param("connectionId")!
  const body = await c.req.json().catch(() => ({}))
  const parsed = CloseDeploymentConnectionSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return c.json({
      error: {
        code: "DEPLOYMENT_INVALID_INPUT",
        message: "Invalid deployment connection close input",
        details: parsed.error.issues,
      },
    }, 400)
  }

  const result = c.get("runManager").closeDeploymentConnection(
    connectionId,
    parsed.data.reason
  )
  if (result.status === "failed") {
    const status = result.error?.code === "DEPLOYMENT_CONNECTION_NOT_FOUND" ? 404 : 503
    return c.json({ error: result.error }, status)
  }

  return c.json(result)
})

export default deployment
