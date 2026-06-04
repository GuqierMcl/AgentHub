import type { ChatStatus } from "ai"
import { useCallback, useMemo, useState } from "react"

import { ChatComposer } from "./ChatComposer"
import { ChatHeader } from "./ChatHeader"
import { EmptyConversationState } from "./EmptyConversationState"
import { QuestionAnswerComposer } from "./QuestionAnswerComposer"
import { TimelineList } from "./MessageList"
import { PinnedMessagesBar } from "./PinnedMessagesBar"
import { usePinnedMessages } from "../hooks/use-pinned-messages"
import type { SingletonTabId } from "@/store/tab-store"
import type {
  Conversation,
  ChatSubmitInput,
  MessageReplySnapshot,
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
  onOpenWorkspaceTab: (tabType: SingletonTabId) => void
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
  onOpenWorkspaceTab,
  onCancelRun,
  onSubmit,
  onToggleWorkspace,
  runStatus,
}: ChatPanelProps) {
  const [replyTargetState, setReplyTargetState] = useState<{
    conversationId: string
    target: MessageReplySnapshot
  } | null>(null)
  const replyTarget =
    replyTargetState?.conversationId === conversation.id
      ? replyTargetState.target
      : null
  const submitStatus = getSubmitStatus(runStatus, connectionStatus)
  const { pins, pinnedMessageIds, togglePin } = usePinnedMessages(conversation.id)
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

  const handleSubmit = useCallback(async (input: ChatSubmitInput) => {
    await onSubmit({
      ...input,
      ...(replyTarget ? { replyToMessageId: replyTarget.messageId } : {}),
    })
    setReplyTargetState(null)
  }, [onSubmit, replyTarget])

  const handleReply = useCallback((target: MessageReplySnapshot) => {
    setReplyTargetState({ conversationId: conversation.id, target })
  }, [conversation.id])

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <ChatHeader
        connectionStatus={connectionStatus}
        conversation={conversation}
        isWorkspaceOpen={isWorkspaceOpen}
        onOpenWorkspaceTab={onOpenWorkspaceTab}
        onToggleWorkspace={onToggleWorkspace}
        runStatus={runStatus}
      />
      {showEmptyConversationState ? (
        <EmptyConversationState
          conversation={conversation}
          key={conversation.id}
        />
      ) : (
        <>
          {pins.length > 0 ? (
            <PinnedMessagesBar pins={pins} onUnpin={(pin) => togglePin(pin.messageId)} />
          ) : null}
          <TimelineList
            agentProfiles={conversation.agents ?? []}
            timelineItems={conversation.timelineItems}
            pinnedMessageIds={pinnedMessageIds}
            onPinToggle={togglePin}
            onReply={handleReply}
          />
        </>
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
          onCancelReply={() => setReplyTargetState(null)}
          onSubmit={handleSubmit}
          onValueChange={onDraftChange}
          replyTo={replyTarget}
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
