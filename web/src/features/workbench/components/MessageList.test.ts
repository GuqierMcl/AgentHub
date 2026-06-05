import { describe, expect, it } from "bun:test"

import type { WorkbenchTimelineChatMessageItem } from "../types"
import { buildRegeneratedBranchTimelineItems } from "./MessageList"

describe("MessageList regenerated branches", () => {
  it("folds regenerate trigger user messages into the source user message", () => {
    const sourceUser: WorkbenchTimelineChatMessageItem = {
      kind: "chat_message",
      id: "msg_source_trigger",
      persistedMessageId: "msg_source_trigger",
      role: "user",
      text: "Original user request.",
      time: "10:00",
      status: "completed",
    }
    const regenerateTrigger: WorkbenchTimelineChatMessageItem = {
      kind: "chat_message",
      id: "msg_regenerate_trigger",
      persistedMessageId: "msg_regenerate_trigger",
      role: "user",
      text: "Original user request.",
      time: "10:05",
      status: "completed",
      regenerate: {
        sourceAssistantMessageId: "msg_source_assistant",
        sourceRunId: "run_source",
        sourceTriggerMessageId: "msg_source_trigger",
        sourceAssistantAgentId: "coder",
        sourceAssistantCreatedAt: "2026-06-05T09:55:00.000Z",
        sourceAssistantExcerpt: "Original assistant answer.",
      },
    }

    const result = buildRegeneratedBranchTimelineItems([
      sourceUser,
      regenerateTrigger,
    ])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: "chat_message",
      persistedMessageId: "msg_source_trigger",
      regenerateRequests: [
        {
          sourceAssistantMessageId: "msg_source_assistant",
          sourceTriggerMessageId: "msg_source_trigger",
        },
      ],
      text: "Original user request.",
    })
  })

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
