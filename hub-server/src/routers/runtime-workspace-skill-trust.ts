import { Hono, type Context } from "hono"
import { z } from "zod"
import { AppError } from "../lib/errors"
import type { RuntimeClient } from "../lib/runtime"
import type { ConversationService } from "../services/conversation.service"

declare module "hono" {
  interface ContextVariableMap {
    runtimeClient: RuntimeClient
    conversationService: ConversationService
  }
}

const runtimeWorkspaceSkillTrust = new Hono()

const WorkspaceSkillRefSchema = z.string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^workspace:(agents|codex|claude-code|opencode):[A-Za-z0-9._:-]+$/)

const TrustQueryBodySchema = z.object({
  conversationId: z.string().trim().min(1),
  skillRefs: z.array(WorkspaceSkillRefSchema).optional(),
}).strict()

const TrustDecisionBodySchema = z.object({
  conversationId: z.string().trim().min(1),
  skillRef: WorkspaceSkillRefSchema,
  trusted: z.boolean(),
  reason: z.string().trim().max(500).optional(),
}).strict()

type WorkspaceSnapshot = {
  workspaceId: string
  backendType: "local"
  rootPath: string
}

runtimeWorkspaceSkillTrust.post("/api/runtime/workspace-skill-trust/query", async (c: Context) => {
  const body = await readJsonBody(c)
  const input = TrustQueryBodySchema.safeParse(body)
  if (!input.success) {
    return c.json({
      error: {
        code: "WORKSPACE_SKILL_TRUST_INVALID_INPUT",
        message: "Invalid workspace Skill trust query.",
        details: input.error.issues,
      },
    }, 400)
  }

  const workspace = await resolveWorkspaceSnapshot(c, input.data.conversationId)
  const client = c.get("runtimeClient")
  const { data, status } = await client.forward(
    "POST",
    "/runtime/workspace-skill-trust/query",
    {
      workspace,
      ...(input.data.skillRefs ? { skillRefs: input.data.skillRefs } : {}),
    },
    { raw: true },
  )
  return c.json(data, status as 200)
})

runtimeWorkspaceSkillTrust.put("/api/runtime/workspace-skill-trust", async (c: Context) => {
  const body = await readJsonBody(c)
  const input = TrustDecisionBodySchema.safeParse(body)
  if (!input.success) {
    return c.json({
      error: {
        code: "WORKSPACE_SKILL_TRUST_INVALID_INPUT",
        message: "Invalid workspace Skill trust decision.",
        details: input.error.issues,
      },
    }, 400)
  }

  const workspace = await resolveWorkspaceSnapshot(c, input.data.conversationId)
  const client = c.get("runtimeClient")
  const { data, status } = await client.forward(
    "PUT",
    "/runtime/workspace-skill-trust",
    {
      workspace,
      skillRef: input.data.skillRef,
      trusted: input.data.trusted,
      ...(input.data.reason ? { reason: input.data.reason } : {}),
    },
    { raw: true },
  )
  return c.json(data, status as 200)
})

async function resolveWorkspaceSnapshot(c: Context, conversationId: string): Promise<WorkspaceSnapshot> {
  const service = c.get("conversationService")
  const conversation = await service.getConversationDetail(conversationId)
  const workspace = getRecord(conversation.metadata)?.workspace
  if (!isRecord(workspace)) {
    throw workspaceNotResolved("Conversation has no bound workspace.")
  }

  if (
    typeof workspace.workspaceId !== "string" ||
    workspace.backendType !== "local" ||
    typeof workspace.rootPath !== "string" ||
    workspace.rootPath.trim().length === 0
  ) {
    throw workspaceNotResolved("Conversation workspace metadata is incomplete.")
  }

  return {
    workspaceId: workspace.workspaceId,
    backendType: "local",
    rootPath: workspace.rootPath,
  }
}

function workspaceNotResolved(message: string): AppError {
  return new AppError(400, "WORKSPACE_NOT_RESOLVED", message)
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function readJsonBody(c: Context): Promise<unknown> {
  const raw = await c.req.text()
  if (raw.trim().length === 0) {
    return {}
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return Symbol("invalid-json")
  }
}

export default runtimeWorkspaceSkillTrust
