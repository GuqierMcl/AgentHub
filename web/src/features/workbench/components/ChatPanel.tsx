import type { ChatStatus } from "ai"

import { ChatComposer } from "./ChatComposer"
import { ChatHeader } from "./ChatHeader"
import { TimelineList } from "./MessageList"
import type { Conversation } from "../types"
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
  const submitStatus = getSubmitStatus(runStatus, connectionStatus)
  const composerDisabled =
    runStatus === "submitted" ||
    runStatus === "queued" ||
    runStatus === "running" ||
    runStatus === "waiting_approval"

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <ChatHeader
        connectionStatus={connectionStatus}
        conversation={conversation}
        isWorkspaceOpen={isWorkspaceOpen}
        onToggleWorkspace={onToggleWorkspace}
        runStatus={runStatus}
      />
      <TimelineList
        agentProfiles={conversation.agents ?? []}
        timelineItems={conversation.timelineItems}
      />
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
