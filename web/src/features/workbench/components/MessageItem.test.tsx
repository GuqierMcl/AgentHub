import { describe, expect, it } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderToStaticMarkup } from "react-dom/server"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { WorkbenchTimelineChatMessageItem } from "../types"
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

describe("MessageItem regenerate marker", () => {
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
})
