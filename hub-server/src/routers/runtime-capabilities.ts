import { Hono, type Context } from "hono"
import { z } from "zod"
import type { RuntimeClient } from "../lib/runtime"
import { AppError } from "../lib/errors"
import type { ConversationService } from "../services/conversation.service"

declare module "hono" {
  interface ContextVariableMap {
    runtimeClient: RuntimeClient
    conversationService: ConversationService
  }
}

const runtimeCapabilities = new Hono()

const RuntimeCapabilitiesQuerySchema = z.object({
  scope: z.enum(["all", "global", "workspace"]).default("global"),
  conversationId: z.string().trim().min(1).optional(),
}).strict()

const CapabilitySourceSchema = z.enum(["agents", "codex", "claude-code", "opencode"])

const RuntimeCapabilitiesRefreshBodySchema = z.object({
  scope: z.enum(["all", "global", "workspace"]).default("global"),
  conversationId: z.string().trim().min(1).optional(),
  sources: z.array(CapabilitySourceSchema).optional(),
}).strict()

type WorkspaceSnapshot = {
  workspaceId: string
  backendType: "local"
  rootPath: string
}

runtimeCapabilities.get("/api/runtime/capabilities", async (c: Context) => {
  const query = RuntimeCapabilitiesQuerySchema.safeParse({
    scope: c.req.query("scope") ?? "global",
    conversationId: c.req.query("conversationId"),
  })

  if (!query.success) {
    return c.json({
      error: {
        code: "CAPABILITY_INVALID_INPUT",
        message: "Invalid runtime capabilities query.",
        details: query.error.issues,
      },
    }, 400)
  }

  const requestBody: {
    scope: "all" | "global" | "workspace"
    workspace?: WorkspaceSnapshot
  } = {
    scope: query.data.scope,
  }

  if (query.data.scope === "workspace" || query.data.scope === "all") {
    if (!query.data.conversationId) {
      throw workspaceNotResolved("Workspace discovery requires conversationId.")
    }
    requestBody.workspace = await resolveWorkspaceSnapshot(c, query.data.conversationId)
  }

  const client = c.get("runtimeClient")
  const { data, status } = await client.forward(
    "POST",
    "/runtime/capabilities/discover",
    requestBody,
    { raw: true },
  )
  return c.json(data, status as 200)
})

runtimeCapabilities.post("/api/runtime/capabilities/refresh", async (c: Context) => {
  const body = await readJsonBody(c)
  const input = RuntimeCapabilitiesRefreshBodySchema.safeParse(body)

  if (!input.success) {
    return c.json({
      error: {
        code: "CAPABILITY_INVALID_INPUT",
        message: "Invalid runtime capabilities refresh body.",
        details: input.error.issues,
      },
    }, 400)
  }

  const requestBody: {
    scope: "all" | "global" | "workspace"
    workspace?: WorkspaceSnapshot
    sources?: Array<"agents" | "codex" | "claude-code" | "opencode">
  } = {
    scope: input.data.scope,
    ...(input.data.sources ? { sources: input.data.sources } : {}),
  }

  if (input.data.scope === "workspace" || input.data.scope === "all") {
    if (!input.data.conversationId) {
      throw workspaceNotResolved("Workspace capability refresh requires conversationId.")
    }
    requestBody.workspace = await resolveWorkspaceSnapshot(c, input.data.conversationId)
  }

  const client = c.get("runtimeClient")
  const { data, status } = await client.forward(
    "POST",
    "/runtime/capabilities/refresh",
    requestBody,
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

export default runtimeCapabilities
