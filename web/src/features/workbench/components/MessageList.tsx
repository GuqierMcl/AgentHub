import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { useMemo } from "react"

import type {
  ConversationAgentProfile,
  MessageVersion,
  WorkbenchTimelineChatMessageItem,
  WorkbenchTimelineItem,
} from "../types"
import type { MessageReplySnapshot } from "../api/messages"
import { getTimelineMessagePinTargetId } from "../utils/message-pin-target"
import { TimelineItem } from "./MessageItem"

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

export function buildRegeneratedBranchTimelineItems(
  items: WorkbenchTimelineItem[]
): WorkbenchTimelineItem[] {
  const assistantMessagesByTargetId = new Map<string, WorkbenchTimelineChatMessageItem>()
  for (const item of items) {
    if (item.kind !== "chat_message" || item.role !== "assistant") continue
    const targetId = getTimelineMessagePinTargetId(item)
    if (targetId) {
      assistantMessagesByTargetId.set(targetId, item)
    }
  }

  const regeneratedByRootId = new Map<string, WorkbenchTimelineChatMessageItem[]>()
  const foldedItemIds = new Set<string>()
  for (const item of items) {
    if (
      item.kind !== "chat_message" ||
      item.role !== "assistant" ||
      !item.regeneratedFromId
    ) {
      continue
    }

    const rootId = findVisibleRegenerateRootId(
      item.regeneratedFromId,
      assistantMessagesByTargetId
    )
    if (!rootId) continue

    const current = regeneratedByRootId.get(rootId) ?? []
    current.push(item)
    regeneratedByRootId.set(rootId, current)
    foldedItemIds.add(item.id)
  }

  return items.flatMap((item) => {
    if (foldedItemIds.has(item.id)) return []
    if (item.kind !== "chat_message" || item.role !== "assistant") return [item]

    const targetId = getTimelineMessagePinTargetId(item)
    const regenerated = targetId ? regeneratedByRootId.get(targetId) : undefined
    if (!targetId || !regenerated?.length) return [item]

    return [{
      ...item,
      versions: [
        createMessageVersionFromTimelineItem(item),
        ...regenerated.map(createMessageVersionFromTimelineItem),
      ],
    }]
  })
}

function findVisibleRegenerateRootId(
  sourceId: string,
  assistantMessagesByTargetId: Map<string, WorkbenchTimelineChatMessageItem>
): string | null {
  let rootId = sourceId
  let rootItem = assistantMessagesByTargetId.get(rootId)
  if (!rootItem) return null

  while (
    rootItem.regeneratedFromId &&
    assistantMessagesByTargetId.has(rootItem.regeneratedFromId)
  ) {
    rootId = rootItem.regeneratedFromId
    rootItem = assistantMessagesByTargetId.get(rootId)!
  }

  return rootId
}

function createMessageVersionFromTimelineItem(
  item: WorkbenchTimelineChatMessageItem
): MessageVersion {
  const messageId = getTimelineMessagePinTargetId(item) ?? item.persistedMessageId
  return {
    id: messageId ?? item.id,
    ...(messageId ? { messageId } : {}),
    ...(item.regeneratedFromId ? { regeneratedFromId: item.regeneratedFromId } : {}),
    content: item.text,
    ...(item.agentId ? { agentId: item.agentId } : {}),
    time: item.time,
    ...(item.status ? { status: item.status } : {}),
    ...(item.generation ? { generation: item.generation } : {}),
    ...(item.externalModel ? { externalModel: item.externalModel } : {}),
    ...(item.replyTo ? { replyTo: item.replyTo } : {}),
    ...(item.reasoningBlocks?.length ? { reasoningBlocks: item.reasoningBlocks } : {}),
    ...(item.toolItems?.length ? { toolItems: item.toolItems } : {}),
    ...(item.permissionItems?.length ? { permissionItems: item.permissionItems } : {}),
    ...(item.questionItems?.length ? { questionItems: item.questionItems } : {}),
    ...(item.sources?.length ? { sources: item.sources } : {}),
    ...(item.artifacts?.length ? { artifacts: item.artifacts } : {}),
  }
}
