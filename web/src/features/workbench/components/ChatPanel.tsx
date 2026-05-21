import { BotIcon, PinIcon } from "lucide-react"

import { Separator } from "@/components/ui/separator"

import { ChatComposer } from "./ChatComposer"
import { ChatHeader } from "./ChatHeader"
import { MessageList } from "./MessageList"
import type { Conversation } from "../types"
import { getAgentById } from "../mock-data"
import type { Artifact } from "../types"

type ChatPanelProps = {
  conversation: Conversation
  onOpenArtifact: (artifact: Artifact) => void
}

export function ChatPanel({ conversation, onOpenArtifact }: ChatPanelProps) {
  const primaryAgent = getAgentById(conversation.agentIds[0])

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <ChatHeader conversation={conversation} />
      <div className="flex shrink-0 items-center gap-2 border-border border-b bg-muted/40 px-5 py-2 text-muted-foreground text-xs">
        <PinIcon className="size-3.5" />
        <span className="truncate">
          Pinned: 当前为静态 Workbench 原型，不接入后端或 LLM Provider。
        </span>
        {primaryAgent ? (
          <>
            <Separator className="h-4" orientation="vertical" />
            <BotIcon className="size-3.5" />
            <span className="truncate">{primaryAgent.role}</span>
          </>
        ) : null}
      </div>
      <MessageList
        messages={conversation.messages}
        onOpenArtifact={onOpenArtifact}
      />
      <ChatComposer />
    </section>
  )
}
