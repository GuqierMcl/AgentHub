import type { ChatStatus } from "ai"
import { BotIcon, RadioIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"

import { ChatComposer } from "./ChatComposer"
import { ChatHeader } from "./ChatHeader"
import { MessageList } from "./MessageList"
import type { Conversation } from "../types"
import { getAgentById } from "../mock-data"
import type { RuntimeRunStatus } from "../api/runtime-runs"
import type { RunConnectionStatus } from "../store/workbench-store"

type ChatPanelProps = {
  conversation: Conversation
  draft: string
  runStatus: RuntimeRunStatus | "idle" | "submitted"
  connectionStatus: RunConnectionStatus
  isWorkspaceOpen: boolean
  onDraftChange: (draft: string) => void
  onSubmit: (content: string) => Promise<void> | void
  onToggleWorkspace: () => void
}

export function ChatPanel({
  conversation,
  connectionStatus,
  draft,
  isWorkspaceOpen,
  onDraftChange,
  onSubmit,
  onToggleWorkspace,
  runStatus,
}: ChatPanelProps) {
  const primaryAgent = getAgentById(conversation.agentIds[0])
  const submitStatus = getSubmitStatus(runStatus, connectionStatus)
  const runLabel = getRunStatusLabel(runStatus, connectionStatus)
  const composerDisabled =
    runStatus === "submitted" ||
    runStatus === "queued" ||
    runStatus === "running" ||
    runStatus === "waiting_approval"

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <ChatHeader
        conversation={conversation}
        isWorkspaceOpen={isWorkspaceOpen}
        onToggleWorkspace={onToggleWorkspace}
      />
      <div className="flex shrink-0 items-center gap-2 border-border border-b bg-muted/40 px-5 py-2 text-muted-foreground text-xs">
        <RadioIcon className="size-3.5" />
        <span className="truncate">
          当前会话运行状态
        </span>
        <Badge variant={submitStatus === "error" ? "destructive" : "secondary"}>
          {runLabel}
        </Badge>
        {primaryAgent ? (
          <>
            <Separator className="h-4" orientation="vertical" />
            <BotIcon className="size-3.5" />
            <span className="truncate">{primaryAgent.role}</span>
          </>
        ) : null}
      </div>
      <MessageList messages={conversation.messages} />
      <ChatComposer
        disabled={composerDisabled}
        onSubmit={onSubmit}
        onValueChange={onDraftChange}
        status={submitStatus}
        value={draft}
      />
    </section>
  )
}

function getSubmitStatus(
  runStatus: RuntimeRunStatus | "idle" | "submitted",
  connectionStatus: RunConnectionStatus
): ChatStatus {
  if (runStatus === "submitted" || runStatus === "queued") return "submitted"
  if (runStatus === "running" || runStatus === "waiting_approval") return "streaming"
  if (runStatus === "failed" || connectionStatus === "error") return "error"
  return "ready"
}

function getRunStatusLabel(
  runStatus: RuntimeRunStatus | "idle" | "submitted",
  connectionStatus: RunConnectionStatus
): string {
  if (runStatus === "idle") return "空闲"
  if (runStatus === "submitted") return "提交中"
  if (runStatus === "queued") return "排队中"
  if (runStatus === "running") {
    return connectionStatus === "connected" ? "生成中" : "等待事件流"
  }
  if (runStatus === "waiting_approval") return "等待审批"
  if (runStatus === "completed") return "已完成"
  if (runStatus === "failed") return "失败"
  return "已取消"
}
