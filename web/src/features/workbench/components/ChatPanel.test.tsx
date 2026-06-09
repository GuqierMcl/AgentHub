import { beforeEach, describe, expect, it } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderToStaticMarkup } from "react-dom/server"

import { TooltipProvider } from "@/components/ui/tooltip"
import { useWorkbenchStore } from "../store/workbench-store"
import type { Conversation } from "../types"
import { ChatPanel } from "./ChatPanel"

const conversation: Conversation = {
  id: "conv_1",
  title: "Existing conversation",
  mode: "single",
  agentIds: ["coder"],
  agents: [
    {
      id: "coder",
      name: "Coder",
      shortName: "CD",
      role: "primary",
      capabilities: [],
    },
  ],
  preview: "Existing message",
  activeAt: "2026-06-09T08:00:00.000Z",
  workspace: "D:/PyWorkSpace/AgentHub",
  timelineItems: [
    {
      kind: "chat_message",
      id: "msg_1",
      persistedMessageId: "msg_1",
      role: "user",
      text: "Existing message",
      time: "10:00",
      status: "completed",
    },
  ],
}

function renderChatPanel(options?: { loadingMessages?: boolean }): string {
  const queryClient = new QueryClient()
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ChatPanel
          activeRunId={null}
          conversation={conversation}
          connectionStatus="idle"
          isWorkspaceOpen={false}
          loadingMessages={options?.loadingMessages}
          onCancelRun={() => {}}
          onOpenWorkspaceTab={() => {}}
          onRegenerate={() => {}}
          onSubmit={() => {}}
          onToggleWorkspace={() => {}}
          runStatus="idle"
        />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

describe("ChatPanel loading overlay", () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      activeConversationId: null,
      conversations: {},
    })
  })

  it("covers existing chat content with a blurred loading overlay", () => {
    const html = renderChatPanel({ loadingMessages: true })

    expect(html).toContain("data-chat-loading-overlay=\"true\"")
    expect(html).toContain("backdrop-blur")
    expect(html).toContain("正在加载消息")
  })
})
