import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { useMemo } from "react"

import type {
  ConversationAgentProfile,
  WorkbenchTimelineItem,
} from "@/features/workbench/types"
import { buildRegeneratedBranchTimelineItems } from "@/features/workbench/utils/regenerated-branch"
import { TimelineItem } from "@/features/workbench/components/MessageItem"

type InstructTimelineListProps = {
  timelineItems: WorkbenchTimelineItem[]
  agentProfiles: ConversationAgentProfile[]
}

export function InstructTimelineList({
  agentProfiles,
  timelineItems,
}: InstructTimelineListProps) {
  const displayItems = useMemo(
    () => buildRegeneratedBranchTimelineItems(timelineItems),
    [timelineItems]
  )

  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="gap-5 p-5">
        {displayItems.map((item) => (
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


