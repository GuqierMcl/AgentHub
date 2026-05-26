import { PinIcon, ArchiveIcon, MessageSquareTextIcon, UsersIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

import type { ConversationListItem as ConversationListItemType } from "../types"

type ConversationListItemProps = {
  conversation: ConversationListItemType
  selected: boolean
  collapsed?: boolean
  onSelect: (conversationId: string) => void
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return "刚刚"
  if (diffMins < 60) return `${diffMins}分钟前`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}小时前`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}天前`
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
}

export function ConversationListItemView({
  collapsed = false,
  conversation,
  selected,
  onSelect,
}: ConversationListItemProps) {
  if (collapsed) {
    return null
  }

  const isPinned = !!conversation.pinnedAt
  const isArchived = conversation.status === "archived"
  const isGroup = conversation.mode === "group"

  return (
    <button
      className={cn(
        "relative grid w-full grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border border-transparent px-3 py-3 text-left transition-colors hover:bg-accent",
        selected && "border-primary/50 bg-accent"
      )}
      onClick={() => onSelect(conversation.id)}
      type="button"
    >
      <div className="flex size-9 items-center justify-center rounded-lg bg-muted shrink-0">
        {isGroup ? (
          <UsersIcon className="size-4 text-muted-foreground" />
        ) : (
          <MessageSquareTextIcon className="size-4 text-muted-foreground" />
        )}
      </div>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold">
            {conversation.title}
          </span>
          <span className="shrink-0 text-muted-foreground text-xs">
            {conversation.lastMessageAt ? formatTime(conversation.lastMessageAt) : ""}
          </span>
        </span>
        <span className="flex items-center gap-1 truncate text-muted-foreground text-xs">
          <span className="line-clamp-1">
            {conversation.lastMessageId ? "有消息记录" : "无消息"}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1">
          <Badge variant={isGroup ? "default" : "secondary"}>
            {isGroup ? "群聊" : "单聊"}
          </Badge>
          {isPinned ? (
            <PinIcon className="size-3 text-muted-foreground" />
          ) : null}
          {isArchived ? (
            <ArchiveIcon className="size-3 text-muted-foreground" />
          ) : null}
        </span>
      </span>
    </button>
  )
}
