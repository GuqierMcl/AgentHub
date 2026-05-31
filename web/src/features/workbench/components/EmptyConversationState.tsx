import { useState } from "react"
import { MessageSquareTextIcon, UsersRoundIcon } from "lucide-react"

import type { Conversation } from "../types"

type EmptyConversationStateProps = {
  conversation: Conversation
}

type EmptyConversationCopyContext = {
  agentName: string
  agentGroupName: string
  agentCount: number
}

type EmptyConversationCopy = {
  title: string
  description: (context: EmptyConversationCopyContext) => string
}

const SINGLE_EMPTY_CONVERSATION_COPIES: EmptyConversationCopy[] = [
  {
    title: "新的会话",
    description: ({ agentName }) => `${agentName} 已经就位。`,
  },
  {
    title: "上下文已准备好",
    description: ({ agentName }) => `可以和 ${agentName} 开始这一轮协作。`,
  },
  {
    title: "这里还很安静",
    description: ({ agentName }) => `${agentName} 正在等待第一条消息。`,
  },
  {
    title: "新的开始",
    description: ({ agentName }) => `这段对话将从 ${agentName} 开始。`,
  },
]

const GROUP_EMPTY_CONVERSATION_COPIES: EmptyConversationCopy[] = [
  {
    title: "新的群聊",
    description: ({ agentGroupName }) => `${agentGroupName} 已经在场。`,
  },
  {
    title: "协作空间已就绪",
    description: ({ agentCount }) => `${agentCount} 位智能体可以一起处理这个上下文。`,
  },
  {
    title: "群聊还没有消息",
    description: ({ agentGroupName }) => `${agentGroupName} 正在等待第一轮协作。`,
  },
  {
    title: "新的协同上下文",
    description: ({ agentCount }) => `这次会话包含 ${agentCount} 位智能体。`,
  },
]

export function EmptyConversationState({
  conversation,
}: EmptyConversationStateProps) {
  const participantAgents = getDisplayAgents(conversation)
  const context = {
    agentName: participantAgents[0]?.name ?? "智能体",
    agentGroupName: getAgentGroupName(participantAgents),
    agentCount: Math.max(participantAgents.length, 1),
  }
  const [copy] = useState(() => pickEmptyConversationCopy(conversation.mode))
  const Icon = conversation.mode === "group"
    ? UsersRoundIcon
    : MessageSquareTextIcon

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="font-medium text-base">{copy.title}</h2>
          <p className="text-muted-foreground text-sm">
            {copy.description(context)}
          </p>
        </div>
      </div>
    </div>
  )
}

function pickEmptyConversationCopy(
  mode: Conversation["mode"]
): EmptyConversationCopy {
  const copies = mode === "group"
    ? GROUP_EMPTY_CONVERSATION_COPIES
    : SINGLE_EMPTY_CONVERSATION_COPIES
  return pickRandomCopy(copies, `agenthub:empty-conversation-copy:${mode}`)
}

function pickRandomCopy<T>(items: T[], storageKey: string): T {
  let nextIndex = Math.floor(Math.random() * items.length)

  try {
    const previousIndex = Number(window.sessionStorage.getItem(storageKey))
    if (
      items.length > 1 &&
      Number.isInteger(previousIndex) &&
      previousIndex === nextIndex
    ) {
      nextIndex = (nextIndex + 1) % items.length
    }
    window.sessionStorage.setItem(storageKey, String(nextIndex))
  } catch {
    // Session storage is a nicety only; random copy selection still works without it.
  }

  return items[nextIndex]
}

function getDisplayAgents(conversation: Conversation) {
  return (conversation.agents ?? []).filter((agent) =>
    agent.id !== "orchestrator" && agent.role !== "orchestrator"
  )
}

function getAgentGroupName(
  agents: ReturnType<typeof getDisplayAgents>
): string {
  if (agents.length === 0) return "智能体"
  const names = agents.slice(0, 2).map((agent) => agent.name)
  if (agents.length <= 2) return names.join("、")
  return `${names.join("、")} 等 ${agents.length} 位智能体`
}
