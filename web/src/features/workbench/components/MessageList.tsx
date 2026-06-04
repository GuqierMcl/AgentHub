import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"

import type { ConversationAgentProfile, WorkbenchTimelineItem } from "../types"
import { getTimelineMessagePinTargetId } from "../utils/message-pin-target"
import { TimelineItem } from "./MessageItem"

type TimelineListProps = {
  timelineItems: WorkbenchTimelineItem[]
  agentProfiles: ConversationAgentProfile[]
  pinnedMessageIds?: Set<string>
  onPinToggle?: (messageId: string) => void
}

export function TimelineList({
  agentProfiles,
  timelineItems,
  pinnedMessageIds,
  onPinToggle,
}: TimelineListProps) {
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="gap-5 p-5">
        {timelineItems.map((item) => {
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
            />
          )
        })}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}
