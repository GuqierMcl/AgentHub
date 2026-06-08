import { Hono, type Context } from "hono"
import { AppError } from "../lib/errors"
import type { RuntimeClient } from "../lib/runtime"
import type { ConversationService } from "../services/conversation.service"

declare module "hono" {
  interface ContextVariableMap {
    runtimeClient: RuntimeClient
    conversationService: ConversationService
  }
}

const conversationMcpStatus = new Hono()

type WorkspaceSnapshot = {
  workspaceId: string
  backendType: "local"
  rootPath: string
}

conversationMcpStatus.get("/api/conversations/:conversationId/mcp/status", async (c: Context) => {
  const conversationId = c.req.param("conversationId")
  if (!conversationId) {
    throw workspaceNotResolved("Conversation id is required.")
  }
  const workspace = await resolveWorkspaceSnapshot(c, conversationId)
  const client = c.get("runtimeClient")
  const { data, status } = await client.forward(
    "POST",
    "/runtime/mcp/workspace/status",
    {
      workspace,
      connect: true,
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

export default conversationMcpStatus
