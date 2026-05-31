import { useState } from "react"
import { PenIcon, PinIcon, ArchiveIcon, MessageSquareTextIcon, UsersIcon, FolderIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { InfiniteLinearProgress } from "@/components/ui/infinite-linear-progress"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/animate-ui/components/radix/alert-dialog"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

import type { ConversationListDisplayItem as ConversationListItemType } from "../types"

type ConversationListItemProps = {
  conversation: ConversationListItemType
  selected: boolean
  collapsed?: boolean
  onSelect: (conversationId: string) => void
  onPin: (conversationId: string, pinned: boolean) => void
  onArchive: (conversationId: string, archived: boolean) => void
  onRename: (conversationId: string) => void
}

function getWorkspacePath(metadata: Record<string, unknown> | null): string | null {
  if (!metadata || typeof metadata.workspace !== "object" || metadata.workspace === null) return null
  const ws = metadata.workspace as Record<string, unknown>
  return typeof ws.rootPath === "string" ? ws.rootPath : null
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
  const [confirmArchive, setConfirmArchive] = useState(false)

  if (collapsed) {
    return null
  }

  const isPinned = !!conversation.pinnedAt
  const isArchived = conversation.status === "archived"
  const isGroup = conversation.mode === "group"
  const isRunning = isActiveRunStatus(conversation.activeRunStatus)
  const timeLabel = conversation.lastMessageAt
    ? formatTime(conversation.lastMessageAt)
    : ""
  const preview = conversation.lastMessageContent?.trim()
    || (conversation.lastMessageId ? "暂无文本预览" : "无消息")

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            className={cn(
              "group relative block w-full max-w-full overflow-hidden rounded-lg border border-transparent px-3 py-3 text-left transition-colors hover:bg-accent cursor-pointer",
              isRunning && "pb-4",
              selected && "border-primary/50 bg-accent",
              isPinned && "border-l-2 border-primary bg-primary/5"
            )}
            onClick={() => onSelect(conversation.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(conversation.id) } }}
          >
            <div className="flex min-w-0 gap-3">
              <div className="flex size-9 items-center justify-center rounded-lg bg-muted shrink-0">
                {isGroup ? (
                  <UsersIcon className="size-4 text-muted-foreground" />
                ) : (
                  <MessageSquareTextIcon className="size-4 text-muted-foreground" />
                )}
              </div>
              <span className="flex min-w-0 flex-col gap-1 flex-1 pr-14">
                <span className="flex min-w-0 items-center gap-2 pr-5">
                  {isPinned && (
                    <PinIcon className="size-3.5 shrink-0 text-primary fill-current" />
                  )}
                  <span className="truncate text-sm font-semibold">
                    {conversation.title}
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
                  <span className="block min-w-0 truncate">
                    {preview}
                  </span>
                </span>
                {getWorkspacePath(conversation.metadata) && (
                  <span className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
                    <FolderIcon className="size-3 shrink-0" />
                    <span className="block min-w-0 truncate">
                      {getWorkspacePath(conversation.metadata)}
                    </span>
                  </span>
                )}
                <span className="flex min-w-0 items-center gap-1">
                  <Badge variant={isGroup ? "default" : "secondary"}>
                    {isGroup ? "群聊" : "单聊"}
                  </Badge>
                </span>
              </span>
            </div>

            {isRunning ? (
              <span className="absolute right-3 top-9 flex items-center gap-1 text-primary text-xs">
                <Spinner className="size-3.5 shrink-0" />
              </span>
            ) : timeLabel ? (
              <span className="absolute right-3 top-9 max-w-16 truncate text-right text-muted-foreground text-xs">
                {timeLabel}
              </span>
            ) : null}

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
                onClick={(e) => { e.stopPropagation(); setConfirmArchive(true) }}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                title={isArchived ? "取消归档" : "归档"}
              >
                <ArchiveIcon className="size-3.5" />
              </button>
            </div>

            {isRunning && (
              <InfiniteLinearProgress className="absolute inset-x-3 bottom-1 h-0.5" />
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onRename(conversation.id)}>
            <PenIcon />
            编辑
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onPin(conversation.id, !isPinned)}>
            <PinIcon />
            {isPinned ? "取消置顶" : "置顶"}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => setConfirmArchive(true)}>
            <ArchiveIcon />
            {isArchived ? "取消归档" : "归档"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认归档</AlertDialogTitle>
            <AlertDialogDescription>
              确定要归档此会话吗？归档后可在设置中查看和恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => { onArchive(conversation.id, !isArchived) }}>
              归档
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function isActiveRunStatus(
  status: ConversationListItemType["activeRunStatus"]
): boolean {
  return status === "submitted" ||
    status === "queued" ||
    status === "running" ||
    status === "waiting_approval" ||
    status === "waiting_input"
}
