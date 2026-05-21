import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar"

import { getAgentById } from "../mock-data"
import type { Agent, Conversation } from "../types"

export function AgentAvatar({ agent }: { agent: Agent }) {
  return (
    <Avatar size="lg">
      <AvatarFallback>{agent.shortName}</AvatarFallback>
    </Avatar>
  )
}

export function ConversationAvatar({
  conversation,
}: {
  conversation: Conversation
}) {
  const conversationAgents = conversation.agentIds
    .map((id) => getAgentById(id))
    .filter((agent): agent is Agent => Boolean(agent))

  if (conversationAgents.length === 1) {
    return <AgentAvatar agent={conversationAgents[0]} />
  }

  return (
    <AvatarGroup>
      {conversationAgents.slice(0, 3).map((agent) => (
        <Avatar key={agent.id} size="lg">
          <AvatarFallback>{agent.shortName}</AvatarFallback>
        </Avatar>
      ))}
    </AvatarGroup>
  )
}
