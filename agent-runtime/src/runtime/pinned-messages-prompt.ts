import type { PinnedMessage } from "./types"

export function formatPinnedMessagesForPrompt(
  pinnedMessages: PinnedMessage[] | undefined
): string | null {
  if (!pinnedMessages || pinnedMessages.length === 0) return null

  return [
    "<📌 置顶消息 (Pinned Messages)>",
    "以下是用户标记为置顶的关键消息，请在每次回复时优先参考：",
    "",
    ...pinnedMessages.map((message, index) => {
      const note = message.note ? `, note: "${message.note}"` : ""
      return `[${index + 1}] (pinned at ${message.pinnedAt}${note})\n> ${message.content}`
    }),
    "",
    "</📌 置顶消息>",
  ].join("\n")
}
