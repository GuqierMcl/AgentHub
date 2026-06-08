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

const runtimeMcpTrust = new Hono()

const McpRefInputSchema = z.string().trim().min(1).max(500)

const GlobalTrustQueryBodySchema = z.object({
  scope: z.literal("global"),
  mcpRefs: z.array(McpRefInputSchema).optional(),
}).strict()

const WorkspaceTrustQueryBodySchema = z.object({
  scope: z.literal("workspace"),
  conversationId: z.string().trim().min(1),
  mcpRefs: z.array(McpRefInputSchema).optional(),
}).strict()

const TrustQueryBodySchema = z.discriminatedUnion("scope", [
  GlobalTrustQueryBodySchema,
  WorkspaceTrustQueryBodySchema,
])

const GlobalTrustDecisionBodySchema = z.object({
  scope: z.literal("global"),
  mcpRef: McpRefInputSchema,
  trusted: z.boolean(),
  reason: z.string().trim().max(500).optional(),
}).strict()

const WorkspaceTrustDecisionBodySchema = z.object({
  scope: z.literal("workspace"),
  conversationId: z.string().trim().min(1),
  mcpRef: McpRefInputSchema,
  trusted: z.boolean(),
  reason: z.string().trim().max(500).optional(),
}).strict()

const TrustDecisionBodySchema = z.discriminatedUnion("scope", [
  GlobalTrustDecisionBodySchema,
  WorkspaceTrustDecisionBodySchema,
])

type WorkspaceSnapshot = {
  workspaceId: string
  backendType: "local"
  rootPath: string
}

runtimeMcpTrust.post("/api/runtime/mcp-trust/query", async (c: Context) => {
  const body = await readJsonBody(c)
  const input = TrustQueryBodySchema.safeParse(body)
  if (!input.success) {
    return c.json({
      error: {
        code: "MCP_TRUST_INVALID_INPUT",
        message: "Invalid MCP trust query.",
        details: input.error.issues,
      },
    }, 400)
  }

  const client = c.get("runtimeClient")
  if (input.data.scope === "global") {
    const { data, status } = await client.forward(
      "POST",
      "/runtime/mcp-trust/query",
      {
        scope: "global",
        ...(input.data.mcpRefs ? { mcpRefs: input.data.mcpRefs } : {}),
      },
      { raw: true },
    )
    return c.json(data, status as 200)
  }

  const workspace = await resolveWorkspaceSnapshot(c, input.data.conversationId)
  const { data, status } = await client.forward(
    "POST",
    "/runtime/mcp-trust/query",
    {
      scope: "workspace",
      workspace,
      ...(input.data.mcpRefs ? { mcpRefs: input.data.mcpRefs } : {}),
    },
    { raw: true },
  )
  return c.json(data, status as 200)
})

runtimeMcpTrust.put("/api/runtime/mcp-trust", async (c: Context) => {
  const body = await readJsonBody(c)
  const input = TrustDecisionBodySchema.safeParse(body)
  if (!input.success) {
    return c.json({
      error: {
        code: "MCP_TRUST_INVALID_INPUT",
        message: "Invalid MCP trust decision.",
        details: input.error.issues,
      },
    }, 400)
  }

  const client = c.get("runtimeClient")
  if (input.data.scope === "global") {
    const { data, status } = await client.forward(
      "PUT",
      "/runtime/mcp-trust",
      {
        scope: "global",
        mcpRef: input.data.mcpRef,
        trusted: input.data.trusted,
        ...(input.data.reason ? { reason: input.data.reason } : {}),
      },
      { raw: true },
    )
    return c.json(data, status as 200)
  }

  const workspace = await resolveWorkspaceSnapshot(c, input.data.conversationId)
  const { data, status } = await client.forward(
    "PUT",
    "/runtime/mcp-trust",
    {
      scope: "workspace",
      workspace,
      mcpRef: input.data.mcpRef,
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

export default runtimeMcpTrust
