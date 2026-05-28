import type { Conversation, ConversationAgentProfile } from "../types"

export function getConversationAgentProfiles(
  conversation: Conversation
): ConversationAgentProfile[] {
  if (conversation.agents?.length) {
    return conversation.agents
  }

  return conversation.agentIds.map((id) => ({
    id,
    name: id,
    shortName: id.slice(0, 2).toUpperCase(),
    role: "member",
    capabilities: [],
  }))
}
