import { describe, expect, it } from "bun:test"

import { getTimelineMessagePinTargetId } from "./message-pin-target"
import type { WorkbenchTimelineChatMessageItem } from "../types"

function chatMessage(
  input: Partial<WorkbenchTimelineChatMessageItem>
): WorkbenchTimelineChatMessageItem {
  return {
    kind: "chat_message",
    id: "msg_user",
    role: "user",
    text: "hello",
    time: "09:00",
    status: "completed",
    ...input,
  }
}

describe("message pin target ids", () => {
  it("uses persisted message id when a timeline item was merged from backend messages", () => {
    const item = chatMessage({
      id: "chat:run_1:runtime_msg_1",
      role: "assistant",
      runId: "run_1",
      runtimeMessageId: "runtime_msg_1",
      persistedMessageId: "msg_persisted",
    })

    expect(getTimelineMessagePinTargetId(item)).toBe("msg_persisted")
  })

  it("derives the persisted assistant message id from run and runtime message ids", () => {
    const item = chatMessage({
      id: "chat:run_1:runtime_msg_1",
      role: "assistant",
      runId: "run_1",
      runtimeMessageId: "runtime_msg_1",
    })

    expect(getTimelineMessagePinTargetId(item)).toBe("msg_run_1_runtime_msg_1")
  })

  it("does not return local optimistic message ids", () => {
    const item = chatMessage({ id: "local-user-123" })

    expect(getTimelineMessagePinTargetId(item)).toBeNull()
  })
})
