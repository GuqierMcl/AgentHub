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
    parentMessageId: null,
    regeneratedFromId: null,
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
      artifacts: [
        {
          id: "art_diff",
          conversationId,
          runId: "run_tools",
          messageId: "msg_assistant",
          createdByAgentId: "opencode",
          type: "diff",
          title: "Workspace changes",
          status: "ready",
          currentVersionId: "ver_diff",
          metadataJson: {
            source: "runtime.workspaceDiff",
            changedFileCount: 1,
            baselineDirty: false,
            status: "available",
          },
          createdAt: "2026-06-03T10:00:01.000Z",
          updatedAt: "2026-06-03T10:00:01.000Z",
          currentVersion: {
            id: "ver_diff",
            artifactId: "art_diff",
            version: 1,
            source: "agent",
            language: "diff",
            content: "diff --git a/hello.txt b/hello.txt",
            summary: "1 workspace file changed (+1/-0)",
            diffJson: {
              version: 1,
              status: "available",
              changedFiles: [{ path: "hello.txt", additions: 1, deletions: 0 }],
              stats: { filesChanged: 1, additions: 1, deletions: 0 },
              baselineDirty: false,
              runOnlyReliable: true,
              limitations: [],
            },
            createdByAgentId: "opencode",
            createdAt: "2026-06-03T10:00:01.000Z",
          },
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
      persistedMessageId: "msg_assistant",
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
      artifacts: [
        {
          id: "art_diff",
          type: "diff",
          sourceArtifactId: "art_diff",
          conversationId,
          detail: {
            kind: "workspace-diff",
            patchText: "diff --git a/hello.txt b/hello.txt",
          },
        },
      ],
    })
  })

  it("restores reply snapshots into chat message timeline items", () => {
    const conversationId = "conv_reply"
    const message = persistedMessage({
      id: "msg_reply",
      conversationId,
      runId: "run_reply",
      runtimeMessageId: null,
      runtimeRunId: null,
      messageIndex: null,
      role: "user",
      senderType: "user",
      senderId: "user",
      agentId: null,
      parentMessageId: "msg_parent",
      metadataJson: {
        replyTo: {
          messageId: "msg_parent",
          role: "assistant",
          senderType: "agent",
          senderId: "coder",
          agentId: "coder",
          createdAt: "2026-06-03T09:59:00.000Z",
          excerpt: "Original assistant answer.",
        },
      },
      parts: [
        {
          id: "part_reply_text",
          messageId: "msg_reply",
          conversationId,
          runId: "run_reply",
          runtimeEventId: null,
          partKey: "text",
          partIndex: 0,
          entityType: null,
          entityId: null,
          type: "text",
          state: "done",
          text: "Can you expand?",
          payloadJson: {},
          firstEventSequence: 0,
          lastEventSequence: 0,
          createdAt: "2026-06-03T10:00:00.000Z",
          updatedAt: "2026-06-03T10:00:00.000Z",
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
      persistedMessageId: "msg_reply",
      replyTo: {
        messageId: "msg_parent",
        role: "assistant",
        senderType: "agent",
        senderId: "coder",
        agentId: "coder",
        excerpt: "Original assistant answer.",
      },
      text: "Can you expand?",
    })
  })

  it("restores regenerated assistant lineage into chat message timeline items", () => {
    const conversationId = "conv_regenerate"
    const message = persistedMessage({
      id: "msg_regenerated",
      conversationId,
      runId: "run_regenerated",
      runtimeMessageId: "runtime_msg_regenerated",
      regeneratedFromId: "msg_source_assistant",
      parts: [
        {
          id: "part_regenerated_text",
          messageId: "msg_regenerated",
          conversationId,
          runId: "run_regenerated",
          runtimeEventId: "evt_regenerated",
          partKey: "text",
          partIndex: 0,
          entityType: "runtime_message",
          entityId: "runtime_msg_regenerated",
          type: "text",
          state: "done",
          text: "Alternative answer.",
          payloadJson: {},
          firstEventSequence: 1,
          lastEventSequence: 1,
          createdAt: "2026-06-05T10:00:00.000Z",
          updatedAt: "2026-06-05T10:00:00.000Z",
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
      persistedMessageId: "msg_regenerated",
      regeneratedFromId: "msg_source_assistant",
      text: "Alternative answer.",
    })
  })

  it("restores regenerate trigger metadata into user timeline items", () => {
    const conversationId = "conv_regenerate_trigger"
    const message = persistedMessage({
      id: "msg_regenerate_trigger",
      conversationId,
      runId: "run_regenerate_trigger",
      runtimeMessageId: null,
      role: "user",
      senderType: "user",
      senderId: "user",
      agentId: null,
      metadataJson: {
        regenerate: {
          sourceAssistantMessageId: "msg_source_assistant",
          sourceRunId: "run_source",
          sourceTriggerMessageId: "msg_source_trigger",
          sourceAssistantAgentId: "coder",
          sourceAssistantCreatedAt: "2026-06-05T09:55:00.000Z",
          sourceAssistantExcerpt: "Original assistant answer.",
        },
      },
      parts: [
        {
          id: "part_regenerate_trigger_text",
          messageId: "msg_regenerate_trigger",
          conversationId,
          runId: "run_regenerate_trigger",
          runtimeEventId: null,
          partKey: "text",
          partIndex: 0,
          entityType: null,
          entityId: null,
          type: "text",
          state: "done",
          text: "Original user request.",
          payloadJson: {},
          firstEventSequence: 0,
          lastEventSequence: 0,
          createdAt: "2026-06-05T10:00:00.000Z",
          updatedAt: "2026-06-05T10:00:00.000Z",
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
      persistedMessageId: "msg_regenerate_trigger",
      regenerate: {
        sourceAssistantMessageId: "msg_source_assistant",
        sourceAssistantExcerpt: "Original assistant answer.",
      },
      text: "Original user request.",
    })
  })

  it("marks live assistant events in a regenerate run with source assistant lineage", () => {
    const conversationId = "conv_regenerate_live"
    useWorkbenchStore.getState().setConversationChatSpeakers(conversationId, ["coder"])
    const trigger = persistedMessage({
      id: "msg_regenerate_live_trigger",
      conversationId,
      runId: "run_regenerate_live",
      runtimeMessageId: null,
      role: "user",
      senderType: "user",
      senderId: "user",
      agentId: null,
      metadataJson: {
        regenerate: {
          sourceAssistantMessageId: "msg_source_assistant",
          sourceRunId: "run_source",
          sourceTriggerMessageId: "msg_source_trigger",
          sourceAssistantAgentId: "coder",
          sourceAssistantCreatedAt: "2026-06-05T09:55:00.000Z",
          sourceAssistantExcerpt: "Original assistant answer.",
        },
      },
      parts: [],
    })

    useWorkbenchStore.getState().hydrateTimelineFromReplay(
      conversationId,
      [trigger],
      [],
      { id: "run_regenerate_live", runtimeId: "runtime_regenerate_live", status: "running", lastEventSequence: 0, plan: null }
    )
    useWorkbenchStore.getState().applyRuntimeEvents(conversationId, [{
      id: "event_regenerate_delta",
      runId: "run_regenerate_live",
      runtimeRunId: "runtime_regenerate_live",
      type: "message.delta",
      timestamp: "2026-06-05T10:00:01.000Z",
      agentId: "coder",
      messageId: "runtime_msg_regenerated_live",
      messageIndex: 0,
      data: { delta: "Alternative" },
    }])

    const assistant = useWorkbenchStore
      .getState()
      .getConversationState(conversationId)
      .timelineItems
      .find((item) => item.kind === "chat_message" && item.role === "assistant")
    expect(assistant).toMatchObject({
      kind: "chat_message",
      regeneratedFromId: "msg_source_assistant",
      text: "Alternative",
    })
  })
})

describe("workbench service status notices", () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      activeConversationId: null,
      conversations: {},
    })
  })

  it("appends service status notices without duplicating them", () => {
    const conversationId = "conv_service"
    const notice = {
      kind: "service_status_notice" as const,
      id: "service-status:evt_1",
      serviceId: "claude-code" as const,
      serviceLabel: "Claude Code",
      text: "Claude Code · 已启动",
      time: "2026-06-06T00:00:00.000Z",
      status: "started" as const,
    }

    useWorkbenchStore.getState().appendServiceStatusNotice(conversationId, notice)
    useWorkbenchStore.getState().appendServiceStatusNotice(conversationId, notice)

    const items = useWorkbenchStore
      .getState()
      .getConversationState(conversationId)
      .timelineItems

    expect(items).toEqual([notice])
  })
})
