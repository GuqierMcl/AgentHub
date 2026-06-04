import { describe, expect, it } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { TooltipProvider } from "@/components/ui/tooltip"
import { PinnedMessagesBar } from "./PinnedMessagesBar"
import type { MessagePin } from "../api/messages"

describe("PinnedMessagesBar", () => {
  it("shows pinned message content by default", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <PinnedMessagesBar
          pins={[
            {
              id: "mp_1",
              conversationId: "conv_1",
              messageId: "msg_1234567890",
              messageContent: "这是一条足够长、用户能辨认出来的置顶消息内容。",
              note: null,
              sortOrder: 0,
              createdAt: "2026-06-04T08:00:00.000Z",
            } as MessagePin,
          ]}
          onUnpin={() => {}}
        />
      </TooltipProvider>
    )

    expect(html).toContain("收起")
    expect(html).toContain("这是一条足够长、用户能辨认出来的置顶消息内容。")
    expect(html).not.toContain("消息 msg_1234")
  })
})
