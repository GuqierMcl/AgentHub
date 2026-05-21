import { useMemo, useState } from "react"
import { BotIcon, PinIcon } from "lucide-react"

import { Separator } from "@/components/ui/separator"
import { useDocumentTitle } from "@/hooks/useDocumentTitle"
import { cn } from "@/lib/utils"

import { conversations, getAgentById } from "./mock-data"
import { ChatComposer } from "./components/ChatComposer"
import { ChatHeader } from "./components/ChatHeader"
import { ConversationSidebar } from "./components/ConversationSidebar"
import { MessageList } from "./components/MessageList"

export function WorkbenchPage() {
  const [activeConversationId, setActiveConversationId] = useState(
    conversations[0].id
  )
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
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
    <main
      className={cn(
        "grid h-svh min-h-0 overflow-hidden bg-muted text-foreground max-md:grid-rows-[15rem_minmax(0,1fr)]",
        isSidebarCollapsed
          ? "md:grid-cols-[4.25rem_minmax(0,1fr)]"
          : "md:grid-cols-[20rem_minmax(0,1fr)]"
      )}
    >
      <ConversationSidebar
        activeConversationId={activeConversation.id}
        collapsed={isSidebarCollapsed}
        conversations={conversations}
        onSelectConversation={setActiveConversationId}
        onToggleCollapsed={() =>
          setIsSidebarCollapsed((collapsed) => !collapsed)
        }
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
