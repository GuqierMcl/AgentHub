import { describe, expect, it } from "bun:test"

import type { WorkbenchTimelineChatMessageItem } from "../types"
import { buildRegeneratedBranchTimelineItems } from "./MessageList"

describe("MessageList regenerated branches", () => {
  it("folds regenerated assistant messages into source message versions", () => {
    const source: WorkbenchTimelineChatMessageItem = {
      kind: "chat_message",
      id: "chat:run_source:runtime_source",
      persistedMessageId: "msg_source",
      role: "assistant",
      agentId: "coder",
      text: "Original answer.",
      time: "10:00",
      status: "completed",
    }
    const regenerated: WorkbenchTimelineChatMessageItem = {
      kind: "chat_message",
      id: "chat:run_regenerated:runtime_regenerated",
      persistedMessageId: "msg_regenerated",
      regeneratedFromId: "msg_source",
      role: "assistant",
      agentId: "coder",
      text: "Alternative answer.",
      time: "10:05",
      status: "completed",
    }

    const result = buildRegeneratedBranchTimelineItems([source, regenerated])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: "chat_message",
      persistedMessageId: "msg_source",
      versions: [
        {
          id: "msg_source",
          messageId: "msg_source",
          content: "Original answer.",
        },
        {
          id: "msg_regenerated",
          messageId: "msg_regenerated",
          regeneratedFromId: "msg_source",
          content: "Alternative answer.",
        },
      ],
    })
  })
})
