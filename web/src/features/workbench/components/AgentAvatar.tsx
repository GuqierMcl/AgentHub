import {
  AgentAvatar as SharedAgentAvatar,
  type AgentAvatarAgent,
} from "@/components/agent-avatar"
import { AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar"

import type { Conversation } from "../types"
import { getConversationAgentProfiles } from "../utils/conversation-agents"

export function AgentAvatar({ agent }: { agent: AgentAvatarAgent }) {
  return <SharedAgentAvatar agent={agent} size="lg" />
}

export function ConversationAvatar({
  conversation,
}: {
  conversation: Conversation
}) {
  const conversationAgents = getConversationAgentProfiles(conversation)

  if (conversationAgents.length === 1) {
    return <AgentAvatar agent={conversationAgents[0]} />
  }

  return (
    <AvatarGroup>
      {conversationAgents.slice(0, 3).map((agent) => (
        <AgentAvatar agent={agent} key={agent.id} />
      ))}
      {conversationAgents.length > 3 ? (
        <AvatarGroupCount>+{conversationAgents.length - 3}</AvatarGroupCount>
      ) : null}
    </AvatarGroup>
  )
}
