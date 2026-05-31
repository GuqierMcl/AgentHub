import type { ChatStatus } from "ai"
import { useMemo } from "react"

import { ChatComposer } from "./ChatComposer"
import { ChatHeader } from "./ChatHeader"
import { QuestionAnswerComposer } from "./QuestionAnswerComposer"
import { TimelineList } from "./MessageList"
import type {
  Conversation,
  WorkbenchTimelineItem,
  WorkbenchTimelineQuestionItem,
} from "../types"
import type { RuntimeRunStatus } from "../api/runtime-runs"
import type { RunConnectionStatus } from "../store/workbench-store"

type ChatPanelProps = {
  conversation: Conversation
  draft: string
  runStatus: RuntimeRunStatus | "idle" | "submitted"
  connectionStatus: RunConnectionStatus
  isWorkspaceOpen: boolean
  onDraftChange: (draft: string) => void
  onOpenConversationStatus: () => void
  onSubmit: (content: string) => Promise<void> | void
  onToggleWorkspace: () => void
}

export function ChatPanel({
  conversation,
  connectionStatus,
  draft,
  isWorkspaceOpen,
  onDraftChange,
  onOpenConversationStatus,
  onSubmit,
  onToggleWorkspace,
  runStatus,
}: ChatPanelProps) {
  const submitStatus = getSubmitStatus(runStatus, connectionStatus)
  const pendingQuestions = useMemo(
    () => getPendingQuestionItems(conversation.timelineItems),
    [conversation.timelineItems]
  )
  const hasPendingQuestions = pendingQuestions.length > 0
  const composerDisabled =
    runStatus === "submitted" ||
    runStatus === "queued" ||
    runStatus === "running" ||
    runStatus === "waiting_approval" ||
    runStatus === "waiting_input"

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <ChatHeader
        connectionStatus={connectionStatus}
        conversation={conversation}
        isWorkspaceOpen={isWorkspaceOpen}
        onOpenConversationStatus={onOpenConversationStatus}
        onToggleWorkspace={onToggleWorkspace}
        runStatus={runStatus}
      />
      <TimelineList
        agentProfiles={conversation.agents ?? []}
        timelineItems={conversation.timelineItems}
      />
      {hasPendingQuestions ? (
        <QuestionAnswerComposer
          agentProfiles={conversation.agents ?? []}
          requests={pendingQuestions}
        />
      ) : (
        <ChatComposer
          disabled={composerDisabled}
          onSubmit={onSubmit}
          onValueChange={onDraftChange}
          status={submitStatus}
          value={draft}
        />
      )}
    </section>
  )
}

function getSubmitStatus(
  runStatus: RuntimeRunStatus | "idle" | "submitted",
  connectionStatus: RunConnectionStatus
): ChatStatus {
  if (runStatus === "submitted" || runStatus === "queued") return "submitted"
  if (runStatus === "running" || runStatus === "waiting_approval" || runStatus === "waiting_input") return "streaming"
  if (runStatus === "failed" || connectionStatus === "error") return "error"
  return "ready"
}

function getPendingQuestionItems(
  items: WorkbenchTimelineItem[]
): WorkbenchTimelineQuestionItem[] {
  const pending: WorkbenchTimelineQuestionItem[] = []
  for (const item of items) {
    if (item.kind === "question" && item.status === "pending") {
      pending.push(item)
    }
    if (item.kind === "chat_message") {
      pending.push(...(item.questionItems ?? []).filter((question) => question.status === "pending"))
    }
    if (item.kind === "task") {
      pending.push(...(item.questionItems ?? []).filter((question) => question.status === "pending"))
    }
  }
  return pending
}
