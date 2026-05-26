import { PlusIcon, SearchIcon, Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

import type { ConversationListItem as ConversationItem } from "../types"
import { ConversationListItemView } from "./ConversationListItem"

type ConversationSidebarProps = {
  conversations: ConversationItem[]
  loading?: boolean
  activeConversationId: string | null
  onSelectConversation: (conversationId: string) => void
  onAdd: () => void
}

export function ConversationSidebar({
  conversations,
  loading,
  activeConversationId,
  onSelectConversation,
  onAdd,
}: ConversationSidebarProps) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-border border-r bg-sidebar/45">
      <div className="flex shrink-0 flex-col gap-3 border-border border-b px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">聊天</h1>
            <p className="truncate text-muted-foreground text-xs">最近会话</p>
          </div>
          <Button aria-label="新聊天" size="icon-sm" type="button" variant="ghost" onClick={onAdd}>
            <PlusIcon />
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            className="flex-1 justify-start"
            size="sm"
            type="button"
            variant="ghost"
          >
            <SearchIcon data-icon="inline-start" />
            搜索聊天
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : conversations.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">暂无会话</p>
          ) : (
            conversations.map((conversation) => (
              <ConversationListItemView
                conversation={conversation}
                key={conversation.id}
                onSelect={onSelectConversation}
                selected={conversation.id === activeConversationId}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}
