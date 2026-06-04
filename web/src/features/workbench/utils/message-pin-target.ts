import type { WorkbenchTimelineChatMessageItem } from "../types"

export function getTimelineMessagePinTargetId(
  item: WorkbenchTimelineChatMessageItem
): string | null {
  if (item.persistedMessageId) return item.persistedMessageId
  if (item.id.startsWith("local-")) return null
  if (item.role === "assistant" && item.runId && item.runtimeMessageId) {
    return `msg_${item.runId}_${item.runtimeMessageId}`
  }
  return item.id
}
