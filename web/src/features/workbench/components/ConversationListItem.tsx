import { ArchiveIcon, PinIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

import type { Conversation } from "../types"
import { ConversationAvatar } from "./AgentAvatar"

type ConversationListItemProps = {
  conversation: Conversation
  selected: boolean
  onSelect: (conversationId: string) => void
}

export function ConversationListItem({
  conversation,
  selected,
  onSelect,
}: ConversationListItemProps) {
  return (
    <button
      className={cn(
        "relative grid w-full grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border border-transparent px-3 py-3 text-left transition-colors hover:bg-background",
        selected && "border-border bg-background shadow-xs"
      )}
      onClick={() => onSelect(conversation.id)}
      type="button"
    >
      <ConversationAvatar conversation={conversation} />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold">
            {conversation.title}
          </span>
          <span className="shrink-0 text-muted-foreground text-xs">
            {conversation.activeAt}
          </span>
        </span>
        <span className="line-clamp-1 text-muted-foreground text-xs">
          {conversation.preview}
        </span>
        <span className="flex min-w-0 items-center gap-1">
          <Badge variant={conversation.mode === "group" ? "default" : "secondary"}>
            {conversation.mode === "group" ? "群聊" : "单聊"}
          </Badge>
          {conversation.pinned ? (
            <PinIcon className="size-3 text-muted-foreground" />
          ) : null}
          {conversation.archived ? (
            <ArchiveIcon className="size-3 text-muted-foreground" />
          ) : null}
        </span>
      </span>
      {conversation.unread ? (
        <span className="absolute right-3 bottom-3 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
          {conversation.unread}
        </span>
      ) : null}
    </button>
  )
}
