import type { RuntimeMessage, RuntimeRunInput } from "../api/runtime-runs"
import type { ConversationDetail, WorkbenchMessage } from "../types"

type RuntimeWorkspace = NonNullable<RuntimeRunInput["workspace"]>
type TitleSource = NonNullable<
  NonNullable<RuntimeRunInput["conversationState"]>["titleSource"]
>

function isTitleSource(value: unknown): value is TitleSource {
  return value === "default" || value === "auto" || value === "manual"
}

function getTitleSource(metadata: Record<string, unknown> | null): TitleSource {
  const source = metadata?.titleSource
  return isTitleSource(source) ? source : "default"
}

function getRuntimeWorkspace(
  metadata: Record<string, unknown> | null
): RuntimeWorkspace | undefined {
  const workspace = metadata?.workspace
  if (typeof workspace !== "object" || workspace === null) return undefined

  const snapshot = workspace as Record<string, unknown>
  if (
    typeof snapshot.workspaceId !== "string" ||
    snapshot.backendType !== "local" ||
    typeof snapshot.rootPath !== "string"
  ) {
    return undefined
  }

  return {
    workspaceId: snapshot.workspaceId,
    backendType: "local",
    rootPath: snapshot.rootPath,
  }
}

export function projectMessagesToRuntimeHistory(
  messages: WorkbenchMessage[]
): RuntimeMessage[] {
  return messages
    .filter((message) => message.text.trim().length > 0)
    .map((message) => ({
      id: message.id,
      role: message.role,
      agentId: message.agentId,
      content: message.text,
    }))
}

export function buildRuntimeRunInput(
  conversation: ConversationDetail,
  userContent: string,
  previousMessages: WorkbenchMessage[]
): RuntimeRunInput {
  const workspace = getRuntimeWorkspace(conversation.metadata)

  return {
    conversationId: conversation.id,
    mode: conversation.mode,
    participantAgentIds: conversation.agents.map((agent) => agent.agentId),
    addressedAgentIds: [],
    userMessage: {
      role: "user",
      content: userContent,
    },
    history: projectMessagesToRuntimeHistory(previousMessages),
    conversationState: {
      messageCountBeforeRun: previousMessages.length,
      titleSource: getTitleSource(conversation.metadata),
    },
    ...(workspace ? { workspace } : {}),
  }
}
