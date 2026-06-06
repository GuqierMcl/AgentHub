import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { useMemo } from "react"

import type {
  ConversationAgentProfile,
  WorkbenchTimelineItem,
} from "../types"
import { buildRegeneratedBranchTimelineItems } from "../utils/regenerated-branch"
import { getTimelineMessagePinTargetId } from "../utils/message-pin-target"
import { TimelineItem } from "./MessageItem"
import type { MessageReplySnapshot } from "../api/messages"

type TimelineListProps = {
  timelineItems: WorkbenchTimelineItem[]
  agentProfiles: ConversationAgentProfile[]
  pinnedMessageIds?: Set<string>
  onPinToggle?: (messageId: string) => void
  onReply?: (target: MessageReplySnapshot) => void
  onRegenerate?: (messageId: string) => void
}

export function TimelineList({
  agentProfiles,
  timelineItems,
  pinnedMessageIds,
  onPinToggle,
  onReply,
  onRegenerate,
}: TimelineListProps) {
  const displayItems = useMemo(
    () => buildRegeneratedBranchTimelineItems(timelineItems),
    [timelineItems]
  )

  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="gap-5 p-5">
        {displayItems.map((item) => {
          const pinTargetMessageId =
            item.kind === "chat_message"
              ? getTimelineMessagePinTargetId(item)
              : null
          const isPinned = pinTargetMessageId
            ? pinnedMessageIds?.has(pinTargetMessageId) ?? false
            : false

          return (
            <TimelineItem
              agentProfiles={agentProfiles}
              item={item}
              key={item.id}
              isPinned={isPinned}
              pinTargetMessageId={pinTargetMessageId}
              onPinToggle={onPinToggle}
              onReply={onReply}
              onRegenerate={onRegenerate}
              pinnedMessageIds={pinnedMessageIds}
            />
          )
        })}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}
