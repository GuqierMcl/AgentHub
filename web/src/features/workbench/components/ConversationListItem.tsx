import { PenIcon, PinIcon, ArchiveIcon, MessageSquareTextIcon, UsersIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

import type { ConversationListItem as ConversationListItemType } from "../types"

type ConversationListItemProps = {
  conversation: ConversationListItemType
  selected: boolean
  collapsed?: boolean
  onSelect: (conversationId: string) => void
  onPin: (conversationId: string, pinned: boolean) => void
  onArchive: (conversationId: string, archived: boolean) => void
  onRename: (conversationId: string) => void
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
  onPin,
  onArchive,
  onRename,
}: ConversationListItemProps) {
  if (collapsed) {
    return null
  }

  const isPinned = !!conversation.pinnedAt
  const isArchived = conversation.status === "archived"
  const isGroup = conversation.mode === "group"

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group relative w-full rounded-lg border border-transparent px-3 py-3 text-left transition-colors hover:bg-accent cursor-pointer",
        selected && "border-primary/50 bg-accent"
      )}
      onClick={() => onSelect(conversation.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(conversation.id) } }}
    >
      <div className="flex gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-muted shrink-0">
          {isGroup ? (
            <UsersIcon className="size-4 text-muted-foreground" />
          ) : (
            <MessageSquareTextIcon className="size-4 text-muted-foreground" />
          )}
        </div>
        <span className="flex min-w-0 flex-col gap-1 flex-1">
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
          </span>
        </span>
      </div>

      <div className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRename(conversation.id) }}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          title="重命名"
        >
          <PenIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPin(conversation.id, !isPinned) }}
          className={cn(
            "flex size-6 items-center justify-center rounded-md hover:bg-accent transition-colors",
            isPinned ? "text-foreground" : "text-muted-foreground"
          )}
          title={isPinned ? "取消置顶" : "置顶"}
        >
          <PinIcon className={cn("size-3.5", isPinned && "fill-current")} />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onArchive(conversation.id, !isArchived) }}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          title={isArchived ? "取消归档" : "归档"}
        >
          <ArchiveIcon className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
