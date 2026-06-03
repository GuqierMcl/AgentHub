import {
  AgentAvatar as SharedAgentAvatar,
  type AgentAvatarAgent,
} from "@/components/agent-avatar"
import { AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar"
import type { AgentOverride } from "@/features/agents/types"

import type { Conversation } from "../types"
import { getConversationAgentProfiles } from "../utils/conversation-agents"

export function AgentAvatar({
  agent,
  override,
}: {
  agent: AgentAvatarAgent
  override?: AgentOverride | null
}) {
  return <SharedAgentAvatar agent={agent} override={override} size="lg" />
}

export function ConversationAvatar({
  conversation,
  overrides,
}: {
  conversation: Conversation
  overrides?: Record<string, AgentOverride>
}) {
  const conversationAgents = getConversationAgentProfiles(conversation)

  if (conversationAgents.length === 1) {
    return (
      <AgentAvatar
        agent={conversationAgents[0]}
        override={overrides?.[conversationAgents[0].id]}
      />
    )
  }

  return (
    <AvatarGroup>
      {conversationAgents.slice(0, 3).map((agent) => (
        <AgentAvatar
          agent={agent}
          override={overrides?.[agent.id]}
          key={agent.id}
        />
      ))}
      {conversationAgents.length > 3 ? (
        <AvatarGroupCount>+{conversationAgents.length - 3}</AvatarGroupCount>
      ) : null}
    </AvatarGroup>
  )
}
