import { useMemo, useState } from "react"
import { BotIcon, PinIcon } from "lucide-react"

import { Separator } from "@/components/ui/separator"
import { useDocumentTitle } from "@/hooks/useDocumentTitle"

import { conversations, getAgentById } from "./mock-data"
import { ChatComposer } from "./components/ChatComposer"
import { ChatHeader } from "./components/ChatHeader"
import { ConversationSidebar } from "./components/ConversationSidebar"
import { MessageList } from "./components/MessageList"

export function WorkbenchPage() {
  const [activeConversationId, setActiveConversationId] = useState(
    conversations[0].id
  )
  const activeConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.id === activeConversationId
      ) ?? conversations[0],
    [activeConversationId]
  )
  const primaryAgent = getAgentById(activeConversation.agentIds[0])

  useDocumentTitle({
    conversationTitle: activeConversation?.title,
  })

  return (
    <main className="grid h-svh min-h-0 overflow-hidden bg-muted text-foreground md:grid-cols-[20rem_minmax(0,1fr)] max-md:grid-rows-[15rem_minmax(0,1fr)]">
      <ConversationSidebar
        activeConversationId={activeConversation.id}
        conversations={conversations}
        onSelectConversation={setActiveConversationId}
      />

      <section className="flex min-h-0 min-w-0 flex-col bg-background">
        <ChatHeader conversation={activeConversation} />
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
        <MessageList messages={activeConversation.messages} />
        <ChatComposer />
      </section>
    </main>
  )
}
