import { describe, expect, it, beforeEach } from "bun:test"

import type { PersistedMessage } from "../api/messages"
import { useWorkbenchStore } from "./workbench-store"

function persistedMessage(input: Partial<PersistedMessage>): PersistedMessage {
  return {
    id: "msg_assistant",
    conversationId: "conv_tools",
    runId: "run_tools",
    runtimeMessageId: "runtime_msg_tools",
    runtimeRunId: "runtime_run_tools",
    messageIndex: 0,
    surface: "chat",
    role: "assistant",
    senderType: "agent",
    senderId: "opencode",
    agentId: "opencode",
    taskId: null,
    groupId: null,
    status: "completed",
    finishReason: "stop",
    firstEventSequence: 1,
    lastEventSequence: 3,
    metadataJson: {},
    uiMessageJson: null,
    createdAt: "2026-06-03T10:00:00.000Z",
    updatedAt: "2026-06-03T10:00:01.000Z",
    completedAt: "2026-06-03T10:00:01.000Z",
    parts: [],
    artifacts: [],
    ...input,
  }
}

describe("workbench persisted message replay", () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      activeConversationId: null,
      conversations: {},
    })
  })

  it("restores OpenCode tool parts into assistant message tool items", () => {
    const conversationId = "conv_tools"
    const message = persistedMessage({
      parts: [
        {
          id: "part_text",
          messageId: "msg_assistant",
          conversationId,
          runId: "run_tools",
          runtimeEventId: "evt_text",
          partKey: "text",
          partIndex: 0,
          entityType: "runtime_message",
          entityId: "runtime_msg_tools",
          type: "text",
          state: "done",
          text: "Done.",
          payloadJson: { content: "Done." },
          firstEventSequence: 1,
          lastEventSequence: 1,
          createdAt: "2026-06-03T10:00:00.000Z",
          updatedAt: "2026-06-03T10:00:00.000Z",
        },
        {
          id: "part_tool",
          messageId: "msg_assistant",
          conversationId,
          runId: "run_tools",
          runtimeEventId: "evt_tool",
          partKey: "tool:opencode:call_edit",
          partIndex: 1,
          entityType: "tool_call",
          entityId: "opencode:call_edit",
          type: "tool",
          state: "output-available",
          text: "OpenCode · edit",
          payloadJson: {
            summary: "OpenCode · edit",
            externalProvider: "opencode",
            providerToolName: "edit",
            input: { filePath: "hello.txt" },
            output: {
              title: "Edited hello.txt",
              output: "updated file",
            },
          },
          firstEventSequence: 2,
          lastEventSequence: 3,
          createdAt: "2026-06-03T10:00:00.000Z",
          updatedAt: "2026-06-03T10:00:01.000Z",
        },
      ],
    })

    useWorkbenchStore.getState().hydrateTimelineFromReplay(
      conversationId,
      [message],
      [],
      null
    )

    const [item] = useWorkbenchStore.getState().getConversationState(conversationId).timelineItems
    expect(item).toMatchObject({
      kind: "chat_message",
      text: "Done.",
      toolItems: [
        {
          toolCallId: "opencode:call_edit",
          toolName: "edit",
          title: "OpenCode · edit",
          status: "output-available",
          externalProvider: "opencode",
          input: { filePath: "hello.txt" },
          output: {
            title: "Edited hello.txt",
            output: "updated file",
          },
        },
      ],
    })
  })
})
