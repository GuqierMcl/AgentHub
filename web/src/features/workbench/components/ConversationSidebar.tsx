import { useState, useMemo } from "react"
import { PlusIcon, SearchIcon, Loader2Icon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

import type { ConversationListItem as ConversationItem } from "../types"
import { ConversationListItemView } from "./ConversationListItem"

type ConversationSidebarProps = {
  conversations: ConversationItem[]
  loading?: boolean
  activeConversationId: string | null
  onSelectConversation: (conversationId: string) => void
  onAdd: () => void
  onPin: (conversationId: string, pinned: boolean) => void
  onArchive: (conversationId: string, archived: boolean) => void
}

export function ConversationSidebar({
  conversations,
  loading,
  activeConversationId,
  onSelectConversation,
  onAdd,
  onPin,
  onArchive,
}: ConversationSidebarProps) {
  const [search, setSearch] = useState("")

  const filteredConversations = useMemo(() => {
    if (!search) return conversations
    const q = search.toLowerCase()
    return conversations.filter(
      (c) => c.title.toLowerCase().includes(q)
    )
  }, [conversations, search])

  const displayConversations = search ? filteredConversations : conversations

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
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索聊天"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : displayConversations.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              {search ? "无匹配会话" : "暂无会话"}
            </p>
          ) : (
            displayConversations.map((conversation) => (
              <ConversationListItemView
                conversation={conversation}
                key={conversation.id}
                onSelect={onSelectConversation}
                selected={conversation.id === activeConversationId}
                onPin={onPin}
                onArchive={onArchive}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}
