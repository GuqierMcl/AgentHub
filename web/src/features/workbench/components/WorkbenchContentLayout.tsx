import { useCallback, useEffect, useMemo, useRef } from "react"
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { usePanelRef } from "react-resizable-panels"
import { toast } from "sonner"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

import { useTabStore } from "@/store/tab-store"
import type { AgentSummary } from "@/features/agents/types"
import { agentsApi } from "@/features/agents/api/agents"

import { conversationsApi } from "../api/conversations"
import {
  ConversationMessageRequestError,
  conversationMessagesApi,
} from "../api/messages"
import { workbenchQueryKeys } from "../api/query-keys"
import { RightWorkbench } from "../right-workbench/RightWorkbench"
import { runStreamManager } from "../runtime/run-stream-manager"
import {
  isTerminalRunStatus,
  useWorkbenchStore,
} from "../store/workbench-store"
import { ChatPanel } from "./ChatPanel"
import { WorkbenchWelcome } from "./WorkbenchWelcome"
import type {
  Conversation,
  ConversationAgentItem,
  ConversationAgentProfile,
  ConversationDetail,
  ConversationListItem,
  WorkbenchTimelineItem,
} from "../types"

const EMPTY_AGENT_SUMMARIES: AgentSummary[] = []

type WorkbenchContentLayoutProps = {
  activeConversationId: string | null
  onCreateConversation: () => void
}

export function WorkbenchContentLayout({
  activeConversationId,
  onCreateConversation,
}: WorkbenchContentLayoutProps) {
  const queryClient = useQueryClient()
  const workspacePanelRef = usePanelRef()
  const tabs = useTabStore((s) => s.tabs)
  const isWorkspaceCollapsed = useTabStore((s) => s.isWorkspaceCollapsed)
  const setWorkspaceCollapsed = useTabStore((s) => s.setWorkspaceCollapsed)
  const openTab = useTabStore((s) => s.openTab)
  const requestWorkspaceFocus = useTabStore((s) => s.requestWorkspaceFocus)
  const workspaceFocusRequest = useTabStore((s) => s.workspaceFocusRequest)
  const consumeWorkspaceFocusRequest = useTabStore(
    (s) => s.consumeWorkspaceFocusRequest
  )
  const runtimeState = useWorkbenchStore((s) =>
    activeConversationId ? s.conversations[activeConversationId] : undefined
  )
  const setDraft = useWorkbenchStore((s) => s.setDraft)
  const hydrateTimelineFromReplay = useWorkbenchStore((s) => s.hydrateTimelineFromReplay)
  const markRunSubmitted = useWorkbenchStore((s) => s.markRunSubmitted)
  const failRunStart = useWorkbenchStore((s) => s.failRunStart)
  const setConversationChatSpeakers = useWorkbenchStore((s) => s.setConversationChatSpeakers)
  const hasTabsRef = useRef(false)

  const conversationQuery = useQuery({
    queryKey: activeConversationId
      ? workbenchQueryKeys.conversations.detail(activeConversationId)
      : workbenchQueryKeys.conversations.detail("__none__"),
    queryFn: () => conversationsApi.get(activeConversationId ?? ""),
    enabled: !!activeConversationId,
  })

  const agentsQuery = useQuery({
    queryKey: workbenchQueryKeys.agents.all,
    queryFn: () => agentsApi.list({ includeHidden: true, enabledOnly: false }),
    enabled: !!activeConversationId,
  })

  const messagesQuery = useQuery({
    queryKey: activeConversationId
      ? workbenchQueryKeys.conversations.messages(activeConversationId)
      : workbenchQueryKeys.conversations.messages("__none__"),
    queryFn: () => conversationMessagesApi.list(activeConversationId ?? ""),
    enabled: !!activeConversationId,
  })

  const conversationDetail = conversationQuery.data
  const agentSummaries = agentsQuery.data?.agents ?? EMPTY_AGENT_SUMMARIES

  useEffect(() => {
    if (!conversationDetail) return
    syncConversationListCache(queryClient, conversationDetail)
  }, [conversationDetail, queryClient])

  const resolvedAgents = useMemo((): ConversationAgentProfile[] => {
    if (!conversationDetail) return []
    return resolveConversationAgents(
      conversationDetail.agents,
      agentSummaries
    )
  }, [agentSummaries, conversationDetail])

  useEffect(() => {
    if (!conversationDetail) return
    setConversationChatSpeakers(
      conversationDetail.id,
      conversationDetail.agents.map((agent) => agent.agentId)
    )
  }, [conversationDetail, setConversationChatSpeakers])

  useEffect(() => {
    if (!activeConversationId || !conversationDetail || !messagesQuery.data) return

    setConversationChatSpeakers(
      activeConversationId,
      conversationDetail.agents.map((agent) => agent.agentId)
    )

    hydrateTimelineFromReplay(
      activeConversationId,
      messagesQuery.data.timelineRuns,
      messagesQuery.data.activeRun
    )

    if (
      messagesQuery.data.activeRun &&
      !isTerminalRunStatus(messagesQuery.data.activeRun.status)
    ) {
      runStreamManager.connect(
        activeConversationId,
        messagesQuery.data.activeRun.id,
        messagesQuery.data.activeRun.lastEventSequence
      )
    }
  }, [
    activeConversationId,
    conversationDetail,
    hydrateTimelineFromReplay,
    messagesQuery.data,
    setConversationChatSpeakers,
  ])

  const activeConversation = useMemo((): Conversation | null => {
    if (!conversationDetail) return null
    const timelineItems = runtimeState?.timelineItems ?? []
    const workspace = getWorkspacePath(conversationDetail.metadata)
    const latestMessage = getLatestChatMessage(timelineItems)
    return {
      id: conversationDetail.id,
      title: conversationDetail.title,
      mode: conversationDetail.mode,
      agentIds: resolvedAgents.map((agent) => agent.id),
      agents: resolvedAgents,
      preview: latestMessage?.text ?? "",
      activeAt: conversationDetail.lastMessageAt ?? conversationDetail.updatedAt,
      workspace,
      pinned: !!conversationDetail.pinnedAt,
      archived: conversationDetail.status === "archived",
      running: runtimeState?.runStatus
        ? !isTerminalRunStatus(runtimeState.runStatus) &&
          runtimeState.runStatus !== "idle"
        : false,
      timelineItems,
    }
  }, [conversationDetail, resolvedAgents, runtimeState])

  const handleDraftChange = useCallback((draft: string) => {
    if (!activeConversationId) return
    setDraft(activeConversationId, draft)
  }, [activeConversationId, setDraft])

  const handleSubmit = useCallback(async (content: string) => {
    if (!activeConversationId || !conversationDetail) return
    const trimmedContent = content.trim()
    if (!trimmedContent) return

    if (
      runtimeState?.activeRuntimeRunId &&
      !isTerminalRunStatus(runtimeState.runStatus)
    ) {
      toast.info("当前会话已有正在运行的回复")
      return
    }

    setDraft(activeConversationId, "")
    markRunSubmitted(activeConversationId)

    try {
      const result = await conversationMessagesApi.send(
        activeConversationId,
        trimmedContent
      )
      queryClient.setQueryData(
        workbenchQueryKeys.conversations.messages(activeConversationId),
        result
      )
      hydrateTimelineFromReplay(
        activeConversationId,
        result.timelineRuns,
        result.activeRun
      )
      if (result.activeRun && !isTerminalRunStatus(result.activeRun.status)) {
        runStreamManager.connect(
          activeConversationId,
          result.activeRun.id,
          result.activeRun.lastEventSequence
        )
      }
      await queryClient.invalidateQueries({
        queryKey: workbenchQueryKeys.conversations.all,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Run 创建失败"
      const code = err instanceof ConversationMessageRequestError ? err.code : undefined
      failRunStart(activeConversationId, message, code)
      toast.error(code ? `${code}: ${message}` : message)
    }
  }, [
    activeConversationId,
    conversationDetail,
    failRunStart,
    hydrateTimelineFromReplay,
    markRunSubmitted,
    queryClient,
    runtimeState,
    setDraft,
  ])

  const handleToggleWorkspaceCollapsed = useCallback(() => {
    const workspacePanel = workspacePanelRef.current

    if (!workspacePanel) {
      return
    }

    if (workspacePanel.isCollapsed()) {
      workspacePanel.expand()
      setWorkspaceCollapsed(false)
      return
    }

    workspacePanel.collapse()
    setWorkspaceCollapsed(true)
  }, [setWorkspaceCollapsed, workspacePanelRef])

  const handleOpenConversationStatus = useCallback(() => {
    if (!activeConversationId) return

    requestWorkspaceFocus({
      tabType: "conversation-status",
      conversationId: activeConversationId,
      reason: "manual",
      reasonKey: `conversation-status:${activeConversationId}`,
    })
  }, [activeConversationId, requestWorkspaceFocus])

  useEffect(() => {
    if (!workspaceFocusRequest) return

    if (
      workspaceFocusRequest.conversationId &&
      workspaceFocusRequest.conversationId !== activeConversationId
    ) {
      consumeWorkspaceFocusRequest(workspaceFocusRequest.id)
      return
    }

    openTab(workspaceFocusRequest.tabType)

    const workspacePanel = workspacePanelRef.current
    if (workspacePanel?.isCollapsed()) {
      workspacePanel.expand()
    }
    setWorkspaceCollapsed(false)
    consumeWorkspaceFocusRequest(workspaceFocusRequest.id)
  }, [
    activeConversationId,
    consumeWorkspaceFocusRequest,
    openTab,
    setWorkspaceCollapsed,
    workspaceFocusRequest,
    workspacePanelRef,
  ])

  useEffect(() => {
    const workspacePanel = workspacePanelRef.current
    if (!workspacePanel) return

    const hadTabs = hasTabsRef.current
    const hasTabs = tabs.length > 0

    if (hasTabs && !hadTabs) {
      workspacePanel.expand()
      setWorkspaceCollapsed(false)
    } else if (!hasTabs && hadTabs) {
      workspacePanel.collapse()
      setWorkspaceCollapsed(true)
    }

    hasTabsRef.current = hasTabs
  }, [setWorkspaceCollapsed, tabs.length, workspacePanelRef])

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
                onOpenConversationStatus={handleOpenConversationStatus}
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
          <RightWorkbench
            conversation={activeConversation}
            connectionStatus={runtimeState?.connectionStatus ?? "idle"}
            runStatus={runtimeState?.runStatus ?? "idle"}
          />
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

function getLatestChatMessage(
  timelineItems: WorkbenchTimelineItem[]
): Extract<WorkbenchTimelineItem, { kind: "chat_message" }> | undefined {
  return timelineItems.findLast((item) => item.kind === "chat_message")
}

function resolveConversationAgents(
  conversationAgents: ConversationAgentItem[],
  agentSummaries: AgentSummary[]
): ConversationAgentProfile[] {
  const agentById = new Map(agentSummaries.map((agent) => [agent.id, agent]))
  return [...conversationAgents]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((member) => {
      const agent = agentById.get(member.agentId)
      return {
        id: member.agentId,
        name: agent?.name ?? member.agentId,
        shortName: resolveShortName(agent?.name ?? member.agentId, member.agentId),
        role: member.role,
        origin: agent?.origin,
        executorType: agent?.executorType,
        capabilities: agent?.capabilities ?? [],
        enabled: agent?.enabled,
        resolvedModel: agent?.resolvedModel,
      }
    })
}

function resolveShortName(name: string, id: string): string {
  const source = name.trim() || id
  const words = source.split(/[\s_-]+/).filter(Boolean)
  if (words.length > 1) {
    return words
      .slice(0, 2)
      .map((word) => Array.from(word)[0])
      .join("")
      .toUpperCase()
  }
  return Array.from(source).slice(0, 2).join("").toUpperCase()
}

function syncConversationListCache(
  queryClient: QueryClient,
  detail: ConversationDetail
): void {
  for (const status of ["active", "archived"] as const) {
    queryClient.setQueryData<ConversationListItem[]>(
      workbenchQueryKeys.conversations.list(status),
      (items) => items?.map((item) =>
        item.id === detail.id
          ? {
              ...item,
              title: detail.title,
              lastMessageId: detail.lastMessageId,
              lastMessageAt: detail.lastMessageAt,
              updatedAt: detail.updatedAt,
              metadata: detail.metadata,
            }
          : item
      )
    )
  }
}
