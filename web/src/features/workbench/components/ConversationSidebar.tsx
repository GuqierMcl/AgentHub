import { PlusIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

import type { Conversation } from "../types"
import { ConversationListItem } from "./ConversationListItem"

type ConversationSidebarProps = {
  conversations: Conversation[]
  activeConversationId: string
  onSelectConversation: (conversationId: string) => void
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
}: ConversationSidebarProps) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-border border-r bg-sidebar md:w-80">
      <div className="flex shrink-0 items-center justify-between gap-4 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-semibold">
            AgentHub
          </p>
          <h1 className="truncate text-lg font-semibold">消息记录</h1>
        </div>
        <Button aria-label="新建对话" size="icon-sm" type="button">
          <PlusIcon />
        </Button>
      </div>

      <div className="mx-3 mb-3 grid shrink-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded-lg border bg-background px-3 text-muted-foreground">
        <SearchIcon className="size-4" />
        <Input
          aria-label="搜索会话"
          className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          placeholder="搜索会话或 Agent"
        />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 px-2 pb-3">
          {conversations.map((conversation) => (
            <ConversationListItem
              conversation={conversation}
              key={conversation.id}
              onSelect={onSelectConversation}
              selected={conversation.id === activeConversationId}
            />
          ))}
        </div>
      </ScrollArea>
    </aside>
  )
}
