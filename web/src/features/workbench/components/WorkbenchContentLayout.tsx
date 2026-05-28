import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { usePanelRef } from "react-resizable-panels"
import { toast } from "sonner"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

import { useTabStore } from "@/store/tab-store"

import { conversationsApi } from "../api/conversations"
import { workbenchQueryKeys } from "../api/query-keys"
import { RuntimeRunRequestError, runtimeRunsApi } from "../api/runtime-runs"
import { RightWorkbench } from "../right-workbench/RightWorkbench"
import { buildRuntimeRunInput } from "../runtime/run-input"
import { runStreamManager } from "../runtime/run-stream-manager"
import {
  isTerminalRunStatus,
  useWorkbenchStore,
} from "../store/workbench-store"
import { ChatPanel } from "./ChatPanel"
import { WorkbenchWelcome } from "./WorkbenchWelcome"
import type { Conversation } from "../types"

type WorkbenchContentLayoutProps = {
  activeConversationId: string | null
  onCreateConversation: () => void
}

export function WorkbenchContentLayout({
  activeConversationId,
  onCreateConversation,
}: WorkbenchContentLayoutProps) {
  const workspacePanelRef = usePanelRef()
  const [isWorkspaceCollapsed, setIsWorkspaceCollapsed] = useState(true)
  const tabs = useTabStore((s) => s.tabs)
  const runtimeState = useWorkbenchStore((s) =>
    activeConversationId ? s.conversations[activeConversationId] : undefined
  )
  const setDraft = useWorkbenchStore((s) => s.setDraft)
  const addUserMessage = useWorkbenchStore((s) => s.addUserMessage)
  const markRunSubmitted = useWorkbenchStore((s) => s.markRunSubmitted)
  const startRuntimeRun = useWorkbenchStore((s) => s.startRuntimeRun)
  const failRunStart = useWorkbenchStore((s) => s.failRunStart)
  const getConversationState = useWorkbenchStore((s) => s.getConversationState)
  const setConversationChatSpeakers = useWorkbenchStore((s) => s.setConversationChatSpeakers)
  const hasTabsRef = useRef(false)

  const conversationQuery = useQuery({
    queryKey: activeConversationId
      ? workbenchQueryKeys.conversations.detail(activeConversationId)
      : workbenchQueryKeys.conversations.detail("__none__"),
    queryFn: () => conversationsApi.get(activeConversationId ?? ""),
    enabled: !!activeConversationId,
  })

  const conversationDetail = conversationQuery.data

  useEffect(() => {
    if (!conversationDetail) return
    setConversationChatSpeakers(
      conversationDetail.id,
      conversationDetail.agents.map((agent) => agent.agentId)
    )
  }, [conversationDetail, setConversationChatSpeakers])

  const activeConversation = useMemo((): Conversation | null => {
    if (!conversationDetail) return null
    const messages = runtimeState?.messages ?? []
    const workspace = getWorkspacePath(conversationDetail.metadata)
    const latestMessage = messages.at(-1)
    return {
      id: conversationDetail.id,
      title: conversationDetail.title,
      mode: conversationDetail.mode,
      agentIds: conversationDetail.agents.map((agent) => agent.agentId),
      preview: latestMessage?.text ?? "",
      activeAt: conversationDetail.lastMessageAt ?? conversationDetail.updatedAt,
      workspace,
      pinned: !!conversationDetail.pinnedAt,
      archived: conversationDetail.status === "archived",
      running: runtimeState?.runStatus
        ? !isTerminalRunStatus(runtimeState.runStatus) &&
          runtimeState.runStatus !== "idle"
        : false,
      messages,
    }
  }, [conversationDetail, runtimeState])

  const handleDraftChange = useCallback((draft: string) => {
    if (!activeConversationId) return
    setDraft(activeConversationId, draft)
  }, [activeConversationId, setDraft])

  const handleSubmit = useCallback(async (content: string) => {
    if (!activeConversationId || !conversationDetail) return
    const trimmedContent = content.trim()
    if (!trimmedContent) return

    const current = getConversationState(activeConversationId)
    if (
      current.activeRuntimeRunId &&
      !isTerminalRunStatus(current.runStatus)
    ) {
      toast.info("当前会话已有正在运行的回复")
      return
    }

    const previousMessages = current.messages
    const input = buildRuntimeRunInput(
      conversationDetail,
      trimmedContent,
      previousMessages
    )

    addUserMessage(activeConversationId, trimmedContent)
    markRunSubmitted(activeConversationId)

    try {
      const run = await runtimeRunsApi.create(input)
      startRuntimeRun(activeConversationId, run.runId, run.status)
      runStreamManager.connect(activeConversationId, run.runId)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Run 创建失败"
      const code = err instanceof RuntimeRunRequestError ? err.code : undefined
      failRunStart(activeConversationId, message, code)
      toast.error(code ? `${code}: ${message}` : message)
    }
  }, [
    activeConversationId,
    addUserMessage,
    conversationDetail,
    failRunStart,
    getConversationState,
    markRunSubmitted,
    startRuntimeRun,
  ])

  const handleToggleWorkspaceCollapsed = useCallback(() => {
    const workspacePanel = workspacePanelRef.current

    if (!workspacePanel) {
      return
    }

    if (workspacePanel.isCollapsed()) {
      workspacePanel.expand()
      setIsWorkspaceCollapsed(false)
      return
    }

    workspacePanel.collapse()
    setIsWorkspaceCollapsed(true)
  }, [workspacePanelRef])

  useEffect(() => {
    const workspacePanel = workspacePanelRef.current
    if (!workspacePanel) return

    const hadTabs = hasTabsRef.current
    const hasTabs = tabs.length > 0

    if (hasTabs && !hadTabs) {
      workspacePanel.expand()
      setIsWorkspaceCollapsed(false)
    } else if (!hasTabs && hadTabs) {
      workspacePanel.collapse()
      setIsWorkspaceCollapsed(true)
    }

    hasTabsRef.current = hasTabs
  }, [tabs.length, workspacePanelRef])

  if (!activeConversationId) {
    return <WorkbenchWelcome onCreateConversation={onCreateConversation} />
  }

  return (
    <div className="h-full min-h-0 min-w-0 bg-background">
      <ResizablePanelGroup
        id="agenthub-workbench-panels"
        className="min-h-0 min-w-0"
        orientation="horizontal"
      >
        <ResizablePanel
          className="h-full min-h-0 min-w-0"
          id="chat"
          minSize={28}
        >
          <div className="h-full">
            {activeConversation ? (
              <ChatPanel
                conversation={activeConversation}
                connectionStatus={runtimeState?.connectionStatus ?? "idle"}
                draft={runtimeState?.draft ?? ""}
                isWorkspaceOpen={!isWorkspaceCollapsed}
                onDraftChange={handleDraftChange}
                onSubmit={handleSubmit}
                onToggleWorkspace={handleToggleWorkspaceCollapsed}
                runStatus={runtimeState?.runStatus ?? "idle"}
              />
            ) : conversationQuery.isLoading ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                正在加载会话
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                选择或创建会话开始聊天
              </div>
            )}
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel
          className="h-full min-h-0 min-w-0"
          id="workspace"
          collapsible
          defaultSize="0px"
          minSize="17rem"
          panelRef={workspacePanelRef}
          groupResizeBehavior="preserve-pixel-size"
        >
          <RightWorkbench />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

function getWorkspacePath(metadata: Record<string, unknown> | null): string {
  const workspace = metadata?.workspace
  if (typeof workspace !== "object" || workspace === null) return ""
  const snapshot = workspace as Record<string, unknown>
  return typeof snapshot.rootPath === "string" ? snapshot.rootPath : ""
}
