import type {
  MessageRegenerateSnapshot,
  MessageVersion,
  WorkbenchTimelineChatMessageItem,
  WorkbenchTimelineItem,
} from "../types"
import { getTimelineMessagePinTargetId } from "./message-pin-target"

function findVisibleRegenerateRootId(
  sourceId: string,
  assistantMessagesByTargetId: Map<string, WorkbenchTimelineChatMessageItem>,
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
  item: WorkbenchTimelineChatMessageItem,
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

export function buildRegeneratedBranchTimelineItems(
  items: WorkbenchTimelineItem[],
): WorkbenchTimelineItem[] {
  const chatMessagesByTargetId = new Map<string, WorkbenchTimelineChatMessageItem>()
  const assistantMessagesByTargetId = new Map<string, WorkbenchTimelineChatMessageItem>()
  for (const item of items) {
    if (item.kind !== "chat_message") continue
    const targetId = getTimelineMessagePinTargetId(item)
    if (!targetId) continue

    chatMessagesByTargetId.set(targetId, item)
    if (item.role === "assistant") {
      assistantMessagesByTargetId.set(targetId, item)
    }
  }

  const foldedItemIds = new Set<string>()
  const regenerateRequestsBySourceTriggerId = new Map<
    string,
    MessageRegenerateSnapshot[]
  >()
  for (const item of items) {
    if (item.kind !== "chat_message" || item.role !== "user" || !item.regenerate) {
      continue
    }

    const sourceTriggerId = item.regenerate.sourceTriggerMessageId
    const sourceUser = chatMessagesByTargetId.get(sourceTriggerId)
    if (!sourceUser || sourceUser.id === item.id || sourceUser.role !== "user") {
      continue
    }

    const current = regenerateRequestsBySourceTriggerId.get(sourceTriggerId) ?? []
    current.push(item.regenerate)
    regenerateRequestsBySourceTriggerId.set(sourceTriggerId, current)
    foldedItemIds.add(item.id)
  }

  const regeneratedByRootId = new Map<string, WorkbenchTimelineChatMessageItem[]>()
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
      assistantMessagesByTargetId,
    )
    if (!rootId) continue

    const current = regeneratedByRootId.get(rootId) ?? []
    current.push(item)
    regeneratedByRootId.set(rootId, current)
    foldedItemIds.add(item.id)
  }

  return items.flatMap<WorkbenchTimelineItem>((item) => {
    if (foldedItemIds.has(item.id)) return []
    if (item.kind !== "chat_message") return [item]

    const targetId = getTimelineMessagePinTargetId(item)
    if (item.role === "user") {
      const regenerateRequests = targetId
        ? regenerateRequestsBySourceTriggerId.get(targetId)
        : undefined
      if (!regenerateRequests?.length) return [item]

      return [{
        ...item,
        regenerateRequests: [
          ...(item.regenerateRequests ?? []),
          ...regenerateRequests,
        ],
      }]
    }

    if (item.role !== "assistant") return [item]

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
