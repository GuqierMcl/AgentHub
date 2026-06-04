import { describe, expect, it } from "bun:test"
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
