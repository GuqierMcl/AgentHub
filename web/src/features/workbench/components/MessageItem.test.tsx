import { describe, expect, it } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderToStaticMarkup } from "react-dom/server"

import { TooltipProvider } from "@/components/ui/tooltip"
import type {
  WorkbenchTimelineChatMessageItem,
  WorkbenchTimelineToolItem,
} from "../types"
import { TimelineItem } from "./MessageItem"

describe("MessageItem reply preview", () => {
  it("renders a compact quote preview for replied messages", () => {
    const item: WorkbenchTimelineChatMessageItem = {
      kind: "chat_message",
      id: "chat_msg_reply",
      persistedMessageId: "msg_reply",
      role: "user",
      text: "Can you expand?",
      time: "10:00",
      replyTo: {
        messageId: "msg_parent",
        role: "assistant",
        senderType: "agent",
        senderId: "coder",
        agentId: "coder",
        createdAt: "2026-06-03T09:59:00.000Z",
        excerpt: "Original assistant answer.",
      },
    }

    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TimelineItem
          agentProfiles={[]}
          item={item}
          pinTargetMessageId="msg_reply"
        />
      </TooltipProvider>
    )

    expect(html).toContain("回复 assistant")
    expect(html).toContain("Original assistant answer.")
    expect(html).toContain("Can you expand?")
  })
})

describe("MessageItem attachments", () => {
  it("renders image attachment thumbnails inside the message bubble", () => {
    const item: WorkbenchTimelineChatMessageItem = {
      kind: "chat_message",
      id: "msg_image_only",
      persistedMessageId: "msg_image_only",
      role: "user",
      text: "",
      time: "10:00",
      attachments: [
        {
          kind: "image",
          id: "part_image",
          assetId: "asset_1",
          filename: "diagram.png",
          mediaType: "image/png",
          size: 12345,
          width: 640,
          height: 480,
          url: "/api/conversations/conv/assets/images/asset_1/file",
        },
      ],
    }

    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TimelineItem
          agentProfiles={[]}
          item={item}
          pinTargetMessageId="msg_image_only"
        />
      </TooltipProvider>
    )

    expect(html).toContain("alt=\"diagram.png\"")
    expect(html).toContain("/api/conversations/conv/assets/images/asset_1/file")
    expect(html).not.toContain("mt-2")
  })

  it("does not render unsafe image URLs when no sanitized attachments are present", () => {
    const item: WorkbenchTimelineChatMessageItem = {
      kind: "chat_message",
      id: "msg_unsafe_ignored",
      persistedMessageId: "msg_unsafe_ignored",
      role: "user",
      text: "Unsafe image payloads should be ignored.",
      time: "10:00",
    }

    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TimelineItem
          agentProfiles={[]}
          item={item}
          pinTargetMessageId="msg_unsafe_ignored"
        />
      </TooltipProvider>
    )

    expect(html).not.toContain("https://example.test/asset.png")
    expect(html).not.toContain("data:image/png")
    expect(html).not.toContain("blob:")
    expect(html).not.toContain("file:///")
  })

  it("renders attachments for the active message version", () => {
    const item: WorkbenchTimelineChatMessageItem = {
      kind: "chat_message",
      id: "msg_versioned_images",
      persistedMessageId: "msg_original",
      role: "user",
      text: "Original prompt.",
      time: "10:00",
      versions: [
        {
          id: "msg_original",
          messageId: "msg_original",
          content: "Original prompt.",
          time: "10:00",
          attachments: [
            {
              kind: "image",
              id: "part_original_image",
              assetId: "asset_original",
              filename: "original.png",
              mediaType: "image/png",
              size: 111,
              url: "/api/conversations/conv/assets/images/asset_original/file",
            },
          ],
        },
        {
          id: "msg_alternative",
          messageId: "msg_alternative",
          content: "Alternative prompt.",
          time: "10:05",
          attachments: [
            {
              kind: "image",
              id: "part_alternative_image",
              assetId: "asset_alternative",
              filename: "alternative.webp",
              mediaType: "image/webp",
              size: 222,
              url: "/api/conversations/conv/assets/images/asset_alternative/file",
            },
          ],
        },
      ],
    }

    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TimelineItem
          agentProfiles={[]}
          item={item}
          pinTargetMessageId="msg_original"
        />
      </TooltipProvider>
    )

    expect(html).toContain("alt=\"original.png\"")
    expect(html).toContain("alt=\"alternative.webp\"")
    expect(html).not.toContain("mt-2")
  })

  it("preserves source attachments when a version object omits them", () => {
    const item: WorkbenchTimelineChatMessageItem = {
      kind: "chat_message",
      id: "msg_source_with_image",
      persistedMessageId: "msg_source_with_image",
      role: "user",
      text: "Original prompt.",
      time: "10:00",
      attachments: [
        {
          kind: "image",
          id: "part_source_image",
          assetId: "asset_source",
          filename: "source.png",
          mediaType: "image/png",
          size: 333,
          url: "/api/conversations/conv/assets/images/asset_source/file",
        },
      ],
      versions: [
        {
          id: "msg_source_with_image",
          messageId: "msg_source_with_image",
          content: "Original prompt.",
          time: "10:00",
        },
      ],
    }

    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TimelineItem
          agentProfiles={[]}
          item={item}
          pinTargetMessageId="msg_source_with_image"
        />
      </TooltipProvider>
    )

    expect(html).toContain("alt=\"source.png\"")
  })
})

describe("MessageItem regenerate marker", () => {
  it("renders regenerate request summaries on the source user message", () => {
    const item: WorkbenchTimelineChatMessageItem = {
      kind: "chat_message",
      id: "msg_source_trigger",
      persistedMessageId: "msg_source_trigger",
      role: "user",
      text: "Original user request.",
      time: "10:00",
      regenerateRequests: [
        {
          sourceAssistantMessageId: "msg_source_assistant",
          sourceRunId: "run_source",
          sourceTriggerMessageId: "msg_source_trigger",
          sourceAssistantAgentId: "coder",
          sourceAssistantCreatedAt: "2026-06-05T09:55:00.000Z",
          sourceAssistantExcerpt: "Original assistant answer.",
        },
      ],
    }

    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TimelineItem
          agentProfiles={[]}
          item={item}
          pinTargetMessageId="msg_source_trigger"
        />
      </TooltipProvider>
    )

    expect(html).toContain("已请求重新生成 1 次")
    expect(html).toContain("Original user request.")
  })

  it("renders a compact marker for regenerate trigger messages", () => {
    const item: WorkbenchTimelineChatMessageItem = {
      kind: "chat_message",
      id: "msg_regenerate_trigger",
      persistedMessageId: "msg_regenerate_trigger",
      role: "user",
      text: "Original user request.",
      time: "10:05",
      regenerate: {
        sourceAssistantMessageId: "msg_source_assistant",
        sourceRunId: "run_source",
        sourceTriggerMessageId: "msg_source_trigger",
        sourceAssistantAgentId: "coder",
        sourceAssistantCreatedAt: "2026-06-05T09:55:00.000Z",
        sourceAssistantExcerpt: "Original assistant answer.",
      },
    }

    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TimelineItem
          agentProfiles={[]}
          item={item}
          pinTargetMessageId="msg_regenerate_trigger"
        />
      </TooltipProvider>
    )

    expect(html).toContain("重新生成请求")
    expect(html).toContain("源回复：Original assistant answer.")
    expect(html).toContain("Original user request.")
  })

  it("renders a compact marker for regenerated assistant messages", () => {
    const queryClient = new QueryClient()
    const item: WorkbenchTimelineChatMessageItem = {
      kind: "chat_message",
      id: "chat_msg_regenerated",
      persistedMessageId: "msg_regenerated",
      regeneratedFromId: "msg_source_assistant",
      role: "assistant",
      agentId: "coder",
      text: "Alternative answer.",
      time: "10:05",
    }

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <TimelineItem
            agentProfiles={[]}
            item={item}
            pinTargetMessageId="msg_regenerated"
          />
        </TooltipProvider>
      </QueryClientProvider>
    )

    expect(html).toContain("重新生成")
    expect(html).toContain("Alternative answer.")
  })

  it("renders regenerated status in the assistant action row for every branch", () => {
    const queryClient = new QueryClient()
    const item: WorkbenchTimelineChatMessageItem = {
      kind: "chat_message",
      id: "chat_msg_source",
      persistedMessageId: "msg_source_assistant",
      role: "assistant",
      agentId: "coder",
      text: "Original answer.",
      time: "10:00",
      versions: [
        {
          id: "msg_source_assistant",
          messageId: "msg_source_assistant",
          content: "Original answer.",
          time: "10:00",
        },
        {
          id: "msg_regenerated",
          messageId: "msg_regenerated",
          regeneratedFromId: "msg_source_assistant",
          content: "Alternative answer.",
          time: "10:05",
        },
      ],
    }

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <TimelineItem
            agentProfiles={[]}
            item={item}
            pinTargetMessageId="msg_source_assistant"
          />
        </TooltipProvider>
      </QueryClientProvider>
    )

    expect(html.match(/已重新生成/g)?.length).toBe(2)
    expect(html).toMatch(/class="[^"]*hidden[^"]*"[^>]*>[\s\S]*Original answer/)
    expect(html).toMatch(/class="[^"]*block[^"]*"[^>]*>[\s\S]*Alternative answer/)
  })
})

describe("MessageItem edit_file tool diff", () => {
  it("renders internal edit_file output as a code diff instead of a generic tool card", () => {
    const item: WorkbenchTimelineToolItem = {
      kind: "tool",
      id: "tool_edit_file",
      runId: "run_edit",
      toolCallId: "call_edit",
      toolName: "edit_file",
      title: "Edit file",
      time: "10:10",
      status: "output-available",
      input: {
        path: "src/example.ts",
        search: "export const answer = 41",
        replace: "export const answer = 42",
      },
      output: {
        path: "src/example.ts",
        size: 25,
        replacements: 1,
        changed: true,
        diff: {
          format: "unified",
          text: [
            "diff --git a/src/example.ts b/src/example.ts",
            "--- a/src/example.ts",
            "+++ b/src/example.ts",
            "@@ -1 +1 @@",
            "-export const answer = 41",
            "+export const answer = 42",
          ].join("\n"),
          truncated: false,
          additions: 1,
          deletions: 1,
          contextLines: 3,
        },
      },
    }

    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TimelineItem agentProfiles={[]} item={item} />
      </TooltipProvider>
    )

    expect(html).toContain("src/example.ts")
    expect(html).toContain("-export const answer = 41")
    expect(html).toContain("+export const answer = 42")
    expect(html).not.toContain("Parameters")
    expect(html).not.toContain("Result")
  })
})
