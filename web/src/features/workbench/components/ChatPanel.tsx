import type { ChatStatus } from "ai"
import { useMemo } from "react"

import { ChatComposer } from "./ChatComposer"
import { ChatHeader } from "./ChatHeader"
import { EmptyConversationState } from "./EmptyConversationState"
import { QuestionAnswerComposer } from "./QuestionAnswerComposer"
import { TimelineList } from "./MessageList"
import type {
  Conversation,
  ChatSubmitInput,
  WorkbenchTimelineItem,
  WorkbenchTimelineQuestionItem,
} from "../types"
import type { RuntimeRunStatus } from "../api/runtime-runs"
import type { RunConnectionStatus } from "../store/workbench-store"

type ChatPanelProps = {
  conversation: Conversation
  activeRunId: string | null
  draft: string
  runStatus: RuntimeRunStatus | "idle" | "submitted"
  connectionStatus: RunConnectionStatus
  isWorkspaceOpen: boolean
  onDraftChange: (draft: string) => void
  onOpenConversationStatus: () => void
  onCancelRun: (
    runId?: string,
    options?: { fallbackToChat?: boolean }
  ) => Promise<void> | void
  onSubmit: (input: ChatSubmitInput) => Promise<void> | void
  onToggleWorkspace: () => void
}

export function ChatPanel({
  activeRunId,
  conversation,
  connectionStatus,
  draft,
  isWorkspaceOpen,
  onDraftChange,
  onOpenConversationStatus,
  onCancelRun,
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
  const showEmptyConversationState =
    conversation.timelineItems.length === 0 &&
    !hasPendingQuestions &&
    runStatus === "idle"
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
      {showEmptyConversationState ? (
        <EmptyConversationState
          conversation={conversation}
          key={conversation.id}
        />
      ) : (
        <TimelineList
          agentProfiles={conversation.agents ?? []}
          timelineItems={conversation.timelineItems}
        />
      )}
      {hasPendingQuestions ? (
        <QuestionAnswerComposer
          agentProfiles={conversation.agents ?? []}
          onSkipRun={(runId) => onCancelRun(runId, { fallbackToChat: true })}
          requests={pendingQuestions}
        />
      ) : (
        <ChatComposer
          canCancelRun={Boolean(activeRunId)}
          conversationId={conversation.id}
          disabled={composerDisabled}
          onCancelRun={() => onCancelRun()}
          agentProfiles={conversation.agents ?? []}
          conversationMode={conversation.mode}
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
