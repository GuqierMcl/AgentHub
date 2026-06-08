import { Hono, type Context } from "hono"
import {
  WorkspaceSkillTrustDecisionRequestSchema,
  WorkspaceSkillTrustError,
  WorkspaceSkillTrustListRequestSchema,
  WorkspaceSkillTrustService,
} from "../runtime"

declare module "hono" {
  interface ContextVariableMap {
    workspaceSkillTrustService: WorkspaceSkillTrustService
  }
}

export const workspaceSkillTrustRouter = new Hono()

workspaceSkillTrustRouter.post("/runtime/workspace-skill-trust/query", async (c: Context) => {
  const body = await c.req.json().catch(() => null)
  const parsed = WorkspaceSkillTrustListRequestSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return c.json({
      error: {
        code: "WORKSPACE_SKILL_TRUST_INVALID_INPUT",
        message: "Invalid workspace Skill trust query.",
        details: parsed.error.issues,
      },
    }, 400)
  }

  try {
    return c.json(await c.get("workspaceSkillTrustService").list(parsed.data))
  } catch (error) {
    return handleWorkspaceSkillTrustError(c, error)
  }
})

workspaceSkillTrustRouter.put("/runtime/workspace-skill-trust", async (c: Context) => {
  const body = await c.req.json().catch(() => null)
  const parsed = WorkspaceSkillTrustDecisionRequestSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return c.json({
      error: {
        code: "WORKSPACE_SKILL_TRUST_INVALID_INPUT",
        message: "Invalid workspace Skill trust decision.",
        details: parsed.error.issues,
      },
    }, 400)
  }

  try {
    return c.json(await c.get("workspaceSkillTrustService").decide(parsed.data))
  } catch (error) {
    return handleWorkspaceSkillTrustError(c, error)
  }
})

function handleWorkspaceSkillTrustError(c: Context, error: unknown): Response {
  if (error instanceof WorkspaceSkillTrustError) {
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

export default workspaceSkillTrustRouter
