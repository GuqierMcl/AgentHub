import type { ChatStatus } from "ai"
import { useCallback, useMemo, useState } from "react"
import { Loader2Icon } from "lucide-react"

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
  ConversationAgentProfile,
  DeploymentSnapshot,
  MessageReplySnapshot,
  WorkbenchTimelineItem,
  WorkbenchTimelineQuestionItem,
} from "../types"
import type { RuntimeRunStatus } from "../api/runtime-runs"
import {
  useWorkbenchStore,
  type RunConnectionStatus,
} from "../store/workbench-store"

type ChatPanelProps = {
  conversation: Conversation
  activeRunId: string | null
  deploymentSnapshot?: DeploymentSnapshot | null
  runStatus: RuntimeRunStatus | "idle" | "submitted"
  connectionStatus: RunConnectionStatus
  isWorkspaceOpen: boolean
  loadingMessages?: boolean
  onOpenWorkspaceTab: (tabType: SingletonTabId) => void
  onCancelRun: (
    runId?: string,
    options?: { fallbackToChat?: boolean }
  ) => Promise<void> | void
  onSubmit: (input: ChatSubmitInput) => Promise<void> | void
  onRegenerate: (messageId: string) => Promise<void> | void
  onToggleWorkspace: () => void
}

export function ChatPanel({
  activeRunId,
  conversation,
  connectionStatus,
  deploymentSnapshot,
  isWorkspaceOpen,
  loadingMessages = false,
  onOpenWorkspaceTab,
  onCancelRun,
  onRegenerate,
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
    <section className="relative flex h-full min-h-0 min-w-0 flex-col bg-background">
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
            onRegenerate={onRegenerate}
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
        <ConversationDraftComposer
          canCancelRun={Boolean(activeRunId)}
          conversationId={conversation.id}
          deploymentSnapshot={deploymentSnapshot}
          disabled={composerDisabled}
          onCancelRun={() => onCancelRun()}
          agentProfiles={conversation.agents ?? []}
          conversationMode={conversation.mode}
          onCancelReply={() => setReplyTargetState(null)}
          onSubmit={handleSubmit}
          replyTo={replyTarget}
          status={submitStatus}
        />
      )}
      {loadingMessages ? <ChatLoadingOverlay /> : null}
    </section>
  )
}

type ConversationDraftComposerProps = {
  agentProfiles: ConversationAgentProfile[]
  canCancelRun: boolean
  conversationId: string
  conversationMode: Conversation["mode"]
  deploymentSnapshot?: DeploymentSnapshot | null
  disabled: boolean
  onCancelReply: () => void
  onCancelRun: () => Promise<void> | void
  onSubmit: (input: ChatSubmitInput) => Promise<void> | void
  replyTo: MessageReplySnapshot | null
  status: ChatStatus
}

function ConversationDraftComposer({
  agentProfiles,
  canCancelRun,
  conversationId,
  conversationMode,
  deploymentSnapshot,
  disabled,
  onCancelReply,
  onCancelRun,
  onSubmit,
  replyTo,
  status,
}: ConversationDraftComposerProps) {
  const draft = useWorkbenchStore((s) =>
    s.conversations[conversationId]?.draft ?? ""
  )
  const setDraft = useWorkbenchStore((s) => s.setDraft)
  const handleDraftChange = useCallback((nextDraft: string) => {
    setDraft(conversationId, nextDraft)
  }, [conversationId, setDraft])

  return (
    <ChatComposer
      agentProfiles={agentProfiles}
      canCancelRun={canCancelRun}
      conversationId={conversationId}
      conversationMode={conversationMode}
      deploymentSnapshot={deploymentSnapshot}
      disabled={disabled}
      onCancelReply={onCancelReply}
      onCancelRun={onCancelRun}
      onSubmit={onSubmit}
      onValueChange={handleDraftChange}
      replyTo={replyTo}
      status={status}
      value={draft}
    />
  )
}

function ChatLoadingOverlay() {
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-background/55 backdrop-blur-sm"
      data-chat-loading-overlay="true"
    >
      <div className="flex items-center gap-2 rounded-md border border-border/70 bg-background/85 px-3 py-2 text-muted-foreground text-sm shadow-sm">
        <Loader2Icon className="size-4 animate-spin" />
        <span>正在加载消息</span>
      </div>
    </div>
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
