import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"

import type { ConversationAgentProfile, WorkbenchTimelineItem } from "../types"
import { TimelineItem } from "./MessageItem"

type TimelineListProps = {
  timelineItems: WorkbenchTimelineItem[]
  agentProfiles: ConversationAgentProfile[]
}

export function TimelineList({
  agentProfiles,
  timelineItems,
}: TimelineListProps) {
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="gap-5 p-5">
        {timelineItems.map((item) => (
          <TimelineItem
            agentProfiles={agentProfiles}
            item={item}
            key={item.id}
          />
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}
