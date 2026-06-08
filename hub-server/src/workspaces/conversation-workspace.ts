import { AppError } from "../lib/errors"
import type { ConversationService } from "../services/conversation.service"

export type ConversationWorkspaceSnapshot = {
  workspaceId: string
  backendType: "local"
  rootPath: string
}

export async function resolveConversationWorkspaceSnapshot(
  conversationService: ConversationService,
  conversationId: string,
): Promise<ConversationWorkspaceSnapshot> {
  const conversation = await conversationService.getConversationDetail(conversationId)
  const workspace = getRecord(conversation.metadata)?.workspace
  if (!isRecord(workspace)) {
    throw workspaceNotResolved("Conversation has no bound workspace.")
  }

  if (
    typeof workspace.workspaceId !== "string" ||
    workspace.workspaceId.trim().length === 0 ||
    workspace.backendType !== "local" ||
    typeof workspace.rootPath !== "string" ||
    workspace.rootPath.trim().length === 0
  ) {
    throw workspaceNotResolved("Conversation workspace metadata is incomplete.")
  }

  return {
    workspaceId: workspace.workspaceId.trim(),
    backendType: "local",
    rootPath: workspace.rootPath.trim(),
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
