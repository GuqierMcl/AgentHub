import { describe, expect, it, beforeEach } from "bun:test"

import type { ActiveRunSnapshot, ConversationTimelineRunSnapshot, PersistedMessage } from "../api/messages"
import { useTabStore } from "@/store/tab-store"
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

function persistedPart(
  input: Partial<PersistedMessage["parts"][number]>
): PersistedMessage["parts"][number] {
  return {
    id: "part_text",
    messageId: "msg_assistant",
    conversationId: "conv_tools",
    runId: "run_tools",
    runtimeEventId: null,
    partKey: "text",
    partIndex: 0,
    entityType: null,
    entityId: null,
    type: "text",
    state: "done",
    text: null,
    payloadJson: {},
    firstEventSequence: 0,
    lastEventSequence: 0,
    createdAt: "2026-06-03T10:00:00.000Z",
    updatedAt: "2026-06-03T10:00:00.000Z",
    ...input,
  }
}

function expectNoPrivateAttachmentFields(value: unknown): void {
  const attachment = value as Record<string, unknown>
  expect("relativePath" in attachment).toBe(false)
  expect("filePath" in attachment).toBe(false)
}

describe("workbench persisted message replay", () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      activeConversationId: null,
      conversations: {},
    })
    useTabStore.setState({
      tabs: [],
      activeTabUid: null,
      mountedTabUids: new Set(),
      tabCounters: { terminal: 0, preview: 0 },
      isWorkspaceCollapsed: true,
      workspaceFocusRequest: null,
      workspaceFocusRequestSeq: 0,
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

  it("restores image-only user messages with persisted attachments", () => {
    const conversationId = "conv_image_only"
    const message = persistedMessage({
      id: "msg_image_only",
      conversationId,
      runId: "run_image_only",
      runtimeMessageId: null,
      runtimeRunId: null,
      messageIndex: null,
      role: "user",
      senderType: "user",
      senderId: "user",
      agentId: null,
      parts: [
        persistedPart({
          id: "part_image_only",
          messageId: "msg_image_only",
          conversationId,
          runId: "run_image_only",
          partKey: "image:asset_1",
          partIndex: 0,
          type: "image",
          payloadJson: {
            kind: "image",
            assetId: "asset_1",
            filename: "diagram.png",
            mediaType: "image/png",
            size: 12345,
            width: 640,
            height: 480,
            url: "/api/conversations/conv_image_only/assets/images/asset_1/file",
            relativePath: "conversation-assets/conv_image_only/images/asset_1/original.png",
          },
        }),
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
      persistedMessageId: "msg_image_only",
      role: "user",
      text: "",
      attachments: [
        {
          kind: "image",
          id: "part_image_only",
          assetId: "asset_1",
          filename: "diagram.png",
          mediaType: "image/png",
          size: 12345,
          width: 640,
          height: 480,
          url: "/api/conversations/conv_image_only/assets/images/asset_1/file",
        },
      ],
    })
    expectNoPrivateAttachmentFields(
      item.kind === "chat_message" ? item.attachments?.[0] : undefined
    )
  })

  it("restores text and image parts into one user timeline message", () => {
    const conversationId = "conv_text_image"
    const message = persistedMessage({
      id: "msg_text_image",
      conversationId,
      runId: "run_text_image",
      runtimeMessageId: null,
      runtimeRunId: null,
      messageIndex: null,
      role: "user",
      senderType: "user",
      senderId: "user",
      agentId: null,
      parts: [
        persistedPart({
          id: "part_text_image_text",
          messageId: "msg_text_image",
          conversationId,
          runId: "run_text_image",
          partKey: "text",
          partIndex: 0,
          type: "text",
          text: "Please inspect this image.",
          payloadJson: { content: "Please inspect this image." },
        }),
        persistedPart({
          id: "part_text_image_image",
          messageId: "msg_text_image",
          conversationId,
          runId: "run_text_image",
          partKey: "image:asset_2",
          partIndex: 1,
          type: "image",
          payloadJson: {
            kind: "image",
            assetId: "asset_2",
            filename: "screenshot.webp",
            mediaType: "image/webp",
            size: 54321,
            url: "/api/conversations/conv_text_image/assets/images/asset_2/file",
          },
        }),
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
      text: "Please inspect this image.",
      attachments: [
        {
          kind: "image",
          id: "part_text_image_image",
          assetId: "asset_2",
          filename: "screenshot.webp",
          mediaType: "image/webp",
          size: 54321,
          url: "/api/conversations/conv_text_image/assets/images/asset_2/file",
        },
      ],
    })
    expectNoPrivateAttachmentFields(
      item.kind === "chat_message" ? item.attachments?.[0] : undefined
    )
  })

  it("ignores unsafe persisted image payloads", () => {
    const conversationId = "conv_unsafe_images"
    const unsafeParts = [
      {
        id: "part_unsafe_media",
        mediaType: "image/svg+xml",
        url: "/api/conversations/conv_unsafe_images/assets/images/asset_svg/file",
      },
      {
        id: "part_unsafe_external",
        mediaType: "image/png",
        url: "https://example.test/asset.png",
      },
      {
        id: "part_unsafe_data",
        mediaType: "image/png",
        url: "data:image/png;base64,abc",
      },
      {
        id: "part_unsafe_blob",
        mediaType: "image/png",
        url: "blob:https://example.test/asset",
      },
      {
        id: "part_unsafe_file",
        mediaType: "image/png",
        url: "file:///tmp/asset.png",
      },
      {
        id: "part_unsafe_raw_path",
        mediaType: "image/png",
        url: "conversation-assets/conv_unsafe_images/images/asset_raw/original.png",
      },
      {
        id: "part_unsafe_missing_file_suffix",
        mediaType: "image/png",
        url: "/api/conversations/conv_unsafe_images/assets/images/asset_no_suffix",
      },
    ].map(({ id, mediaType, url }, index) =>
      persistedPart({
        id,
        messageId: "msg_unsafe_images",
        conversationId,
        runId: "run_unsafe_images",
        partKey: `image:asset_${index}`,
        partIndex: index + 1,
        type: "image",
        payloadJson: {
          kind: "image",
          assetId: `asset_${index}`,
          filename: `${id}.png`,
          mediaType,
          size: 100,
          url,
        },
      })
    )
    const message = persistedMessage({
      id: "msg_unsafe_images",
      conversationId,
      runId: "run_unsafe_images",
      runtimeMessageId: null,
      runtimeRunId: null,
      messageIndex: null,
      role: "user",
      senderType: "user",
      senderId: "user",
      agentId: null,
      parts: [
        persistedPart({
          id: "part_unsafe_text",
          messageId: "msg_unsafe_images",
          conversationId,
          runId: "run_unsafe_images",
          text: "Unsafe image payloads should be ignored.",
          payloadJson: { content: "Unsafe image payloads should be ignored." },
        }),
        ...unsafeParts,
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
      text: "Unsafe image payloads should be ignored.",
    })
    expect(item.kind === "chat_message" ? item.attachments : undefined).toBeUndefined()
  })

  it("preserves attachments when matching persisted replay messages merge", () => {
    const conversationId = "conv_image_merge"
    const triggerWithoutImage = persistedMessage({
      id: "msg_image_merge",
      conversationId,
      runId: "run_image_merge",
      runtimeMessageId: null,
      runtimeRunId: null,
      messageIndex: null,
      role: "user",
      senderType: "user",
      senderId: "user",
      agentId: null,
      parts: [
        persistedPart({
          id: "part_image_merge_text",
          messageId: "msg_image_merge",
          conversationId,
          runId: "run_image_merge",
          text: "Analyze this.",
          payloadJson: { content: "Analyze this." },
        }),
      ],
    })
    const messageWithImage = persistedMessage({
      ...triggerWithoutImage,
      parts: [
        ...triggerWithoutImage.parts,
        persistedPart({
          id: "part_image_merge_image",
          messageId: "msg_image_merge",
          conversationId,
          runId: "run_image_merge",
          partKey: "image:asset_merge",
          partIndex: 1,
          type: "image",
          payloadJson: {
            kind: "image",
            assetId: "asset_merge",
            filename: "merge.png",
            mediaType: "image/png",
            size: 999,
            url: "/api/conversations/conv_image_merge/assets/images/asset_merge/file",
          },
        }),
      ],
    })
    const timelineRuns: ConversationTimelineRunSnapshot[] = [
      {
        run: {
          id: "run_image_merge",
          runtimeId: "runtime_image_merge",
          status: "completed",
          triggerMessageId: "msg_image_merge",
          createdAt: "2026-06-03T10:00:00.000Z",
          lastEventSequence: 0,
        },
        triggerMessage: triggerWithoutImage,
        events: [],
      },
    ]

    useWorkbenchStore.getState().hydrateTimelineFromReplay(
      conversationId,
      [messageWithImage],
      timelineRuns,
      null
    )

    const [item] = useWorkbenchStore.getState().getConversationState(conversationId).timelineItems
    expect(item).toMatchObject({
      kind: "chat_message",
      id: "msg_image_merge",
      text: "Analyze this.",
      attachments: [
        {
          id: "part_image_merge_image",
          assetId: "asset_merge",
          filename: "merge.png",
        },
      ],
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

  it("keeps live run output when a stale replay snapshot hydrates after completion", () => {
    const conversationId = "conv_stale_replay"
    const runId = "run_stale_replay"
    const runtimeRunId = "runtime_stale_replay"
    const trigger = persistedMessage({
      id: "msg_stale_trigger",
      conversationId,
      runId,
      runtimeMessageId: null,
      runtimeRunId: null,
      role: "user",
      senderType: "user",
      senderId: "user",
      agentId: null,
      parts: [
        {
          id: "part_stale_trigger_text",
          messageId: "msg_stale_trigger",
          conversationId,
          runId,
          runtimeEventId: null,
          partKey: "text",
          partIndex: 0,
          entityType: null,
          entityId: null,
          type: "text",
          state: "done",
          text: "Please answer.",
          payloadJson: {},
          firstEventSequence: 0,
          lastEventSequence: 0,
          createdAt: "2026-06-05T10:00:00.000Z",
          updatedAt: "2026-06-05T10:00:00.000Z",
        },
      ],
    })
    const staleTimelineRuns: ConversationTimelineRunSnapshot[] = [
      {
        run: {
          id: runId,
          runtimeId: runtimeRunId,
          status: "running",
          triggerMessageId: trigger.id,
          createdAt: "2026-06-05T10:00:00.000Z",
          lastEventSequence: 0,
        },
        triggerMessage: trigger,
        events: [],
      },
    ]
    const staleActiveRun: ActiveRunSnapshot = {
      id: runId,
      runtimeId: runtimeRunId,
      status: "running",
      lastEventSequence: 0,
      plan: null,
    }

    useWorkbenchStore.getState().setConversationChatSpeakers(conversationId, ["coder"])
    useWorkbenchStore.getState().hydrateTimelineFromReplay(
      conversationId,
      [trigger],
      staleTimelineRuns,
      staleActiveRun
    )
    useWorkbenchStore.getState().applyRuntimeEvents(conversationId, [
      {
        id: "event_stale_message_completed",
        runId,
        runtimeRunId,
        type: "message.completed",
        timestamp: "2026-06-05T10:00:01.000Z",
        agentId: "coder",
        messageId: "runtime_msg_stale",
        messageIndex: 0,
        data: { content: "Final answer." },
      },
      {
        id: "event_stale_run_completed",
        runId,
        runtimeRunId,
        type: "run.completed",
        timestamp: "2026-06-05T10:00:02.000Z",
        data: { status: "completed" },
      },
    ])

    useWorkbenchStore.getState().hydrateTimelineFromReplay(
      conversationId,
      [trigger],
      staleTimelineRuns,
      staleActiveRun
    )

    const state = useWorkbenchStore.getState().getConversationState(conversationId)
    const assistant = state.timelineItems.find(
      (item) => item.kind === "chat_message" && item.role === "assistant"
    )
    expect(state.runStatus).toBe("completed")
    expect(assistant).toMatchObject({
      kind: "chat_message",
      id: `chat:${runId}:runtime_msg_stale`,
      text: "Final answer.",
      status: "completed",
    })
  })

  it("hydrates deployment preview state from replay without adding timeline tool cards", () => {
    const conversationId = "conv_deploy_replay"
    const runId = "run_deploy_replay"
    const trigger = persistedMessage({
      id: "msg_deploy_trigger",
      conversationId,
      runId,
      runtimeMessageId: null,
      runtimeRunId: null,
      role: "user",
      senderType: "user",
      senderId: "user",
      agentId: null,
      parts: [],
    })
    const timelineRuns: ConversationTimelineRunSnapshot[] = [
      {
        run: {
          id: runId,
          runtimeId: "runtime_deploy_replay",
          status: "completed",
          triggerMessageId: trigger.id,
          createdAt: "2026-06-09T10:00:00.000Z",
          lastEventSequence: 5,
        },
        triggerMessage: trigger,
        events: [
          {
            sequence: 1,
            event: {
              id: "evt_deploy_started",
              runId,
              type: "deployment.started",
              timestamp: "2026-06-09T10:00:01.000Z",
              agentId: "deploy",
              data: {
                deploymentId: "dep_1",
                conversationId,
                status: "running",
                title: "Production deploy",
                server: {
                  id: "srv_1",
                  displayName: "Production",
                  hostLabel: "prod.example.com",
                  user: "deploy",
                },
              },
            },
          },
          {
            sequence: 2,
            event: {
              id: "evt_deploy_connected",
              runId,
              type: "deployment.connection.changed",
              timestamp: "2026-06-09T10:00:02.000Z",
              agentId: "deploy",
              data: {
                deploymentId: "dep_1",
                conversationId,
                connectionId: "conn_1",
                connectionStatus: "connected",
              },
            },
          },
          {
            sequence: 3,
            event: {
              id: "evt_deploy_log",
              runId,
              type: "deployment.log.appended",
              timestamp: "2026-06-09T10:00:03.000Z",
              agentId: "deploy",
              data: {
                deploymentId: "dep_1",
                conversationId,
                commandId: "cmd_1",
                stream: "stdout",
                text: "docker ok\n",
              },
            },
          },
          {
            sequence: 4,
            event: {
              id: "evt_deploy_release",
              runId,
              type: "deployment.release_note.updated",
              timestamp: "2026-06-09T10:00:04.000Z",
              agentId: "deploy",
              data: {
                deploymentId: "dep_1",
                conversationId,
                releaseNote: "Published with Docker Compose.",
              },
            },
          },
          {
            sequence: 5,
            event: {
              id: "evt_deploy_preview",
              runId,
              type: "deployment.preview.requested",
              timestamp: "2026-06-09T10:00:05.000Z",
              agentId: "deploy",
              data: {
                deploymentId: "dep_1",
                conversationId,
                url: "https://app.example.com",
                openMode: "preview-tab",
              },
            },
          },
        ],
      },
    ]

    useWorkbenchStore.getState().hydrateTimelineFromReplay(
      conversationId,
      [trigger],
      timelineRuns,
      null
    )

    const state = useWorkbenchStore.getState().getConversationState(conversationId)
    expect(state.deploymentSnapshot).toMatchObject({
      deploymentId: "dep_1",
      title: "Production deploy",
      server: {
        displayName: "Production",
      },
      connectionId: "conn_1",
      connectionStatus: "stale",
      deploymentUrl: "https://app.example.com",
      releaseNote: "Published with Docker Compose.",
      logs: [
        {
          commandId: "cmd_1",
          stream: "stdout",
          text: "docker ok\n",
        },
      ],
    })
    expect(state.timelineItems.some((item) => item.kind === "tool")).toBe(false)
    expect(useTabStore.getState().tabs).toHaveLength(0)
  })

  it("opens deployment preview tabs only for live preview request events", () => {
    const conversationId = "conv_deploy_live"
    useWorkbenchStore.getState().setActiveConversationId(conversationId)

    const previewEvent = {
      id: "evt_live_preview",
      runId: "run_deploy_live",
      type: "deployment.preview.requested",
      timestamp: "2026-06-09T10:00:00.000Z",
      agentId: "deploy",
      data: {
        deploymentId: "dep_live",
        conversationId,
        url: "https://live.example.com",
        openMode: "preview-tab",
        label: "Live deploy",
      },
    }

    useWorkbenchStore.getState().applyRuntimeEventEnvelopes(
      conversationId,
      [{ sequence: 1, event: previewEvent }],
      { source: "replay" }
    )
    expect(useTabStore.getState().tabs).toHaveLength(0)

    useWorkbenchStore.getState().applyRuntimeEventEnvelopes(
      conversationId,
      [{ sequence: 2, event: { ...previewEvent, id: "evt_live_preview_2" } }],
      { source: "live" }
    )

    expect(useTabStore.getState().tabs).toEqual([
      expect.objectContaining({
        type: "preview",
        title: "Live deploy",
        payload: {
          source: "deploy",
          initialUrl: "https://live.example.com",
        },
      }),
    ])
  })

  it("requests deploy preview focus for live deployment events only", () => {
    const conversationId = "conv_deploy_focus"
    const deploymentEvent = {
      id: "evt_deploy_command_started",
      runId: "run_deploy_focus",
      type: "deployment.command.started",
      timestamp: "2026-06-09T10:00:00.000Z",
      agentId: "deploy",
      data: {
        deploymentId: "dep_focus",
        conversationId,
        commandId: "cmd_focus",
        command: "docker compose up -d",
        startedAt: "2026-06-09T10:00:00.000Z",
      },
    }

    useWorkbenchStore.getState().setActiveConversationId(conversationId)
    useWorkbenchStore.getState().applyRuntimeEventEnvelopes(
      conversationId,
      [{ sequence: 1, event: deploymentEvent }],
      { source: "replay" }
    )

    expect(useTabStore.getState().workspaceFocusRequest).toBeNull()

    useWorkbenchStore.getState().applyRuntimeEventEnvelopes(
      conversationId,
      [{ sequence: 2, event: { ...deploymentEvent, id: "evt_deploy_command_started_live" } }],
      { source: "live" }
    )

    expect(useTabStore.getState().workspaceFocusRequest).toMatchObject({
      tabType: "deploy",
      conversationId,
      reason: "deployment",
      reasonKey: "dep_focus",
    })
  })

  it("updates deployment health from progress events", () => {
    const conversationId = "conv_deploy_health"

    useWorkbenchStore.getState().applyRuntimeEventEnvelopes(
      conversationId,
      [{
        sequence: 1,
        event: {
          id: "evt_deploy_health",
          runId: "run_deploy_health",
          type: "deployment.progress.updated",
          timestamp: "2026-06-09T10:00:00.000Z",
          agentId: "deploy",
          data: {
            deploymentId: "dep_health",
            conversationId,
            message: "Deployment URL responded with 204",
            health: {
              url: "https://app.example.com/health",
              ok: true,
              status: 204,
              durationMs: 42,
            },
          },
        },
      }],
      { source: "live" }
    )

    const state = useWorkbenchStore.getState().getConversationState(conversationId)
    expect(state.deploymentSnapshot).toMatchObject({
      deploymentId: "dep_health",
      progress: {
        message: "Deployment URL responded with 204",
      },
      health: {
        url: "https://app.example.com/health",
        ok: true,
        status: 204,
        durationMs: 42,
      },
    })
  })
})
