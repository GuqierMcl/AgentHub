import { useCallback, useEffect, useMemo, useRef, startTransition } from "react"
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { usePanelRef } from "react-resizable-panels"
import { toast } from "sonner"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

import { useTabStore, type SingletonTabId } from "@/store/tab-store"
import type { AgentSummary } from "@/features/agents/types"
import { agentsApi } from "@/features/agents/api/agents"

import { conversationsApi } from "../api/conversations"
import {
  ConversationMessageRequestError,
  conversationMessagesApi,
} from "../api/messages"
import { workbenchQueryKeys } from "../api/query-keys"
import type { RuntimeRunEvent, RuntimeRunStatus } from "../api/runtime-runs"
import { RightWorkbench } from "../right-workbench/RightWorkbench"
import { runStreamManager } from "../runtime/run-stream-manager"
import { submitWorkbenchMessage } from "../runtime/submit-message"
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
  ChatSubmitInput,
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
  const applyRuntimeEvents = useWorkbenchStore((s) => s.applyRuntimeEvents)
  const failRunStart = useWorkbenchStore((s) => s.failRunStart)
  const setConversationChatSpeakers = useWorkbenchStore((s) => s.setConversationChatSpeakers)
  const hasTabsRef = useRef(false)
  const lastHydratedAtRef = useRef<Record<string, number>>({})

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
    staleTime: 30_000,
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
      agentSummaries,
      {
        mode: conversationDetail.mode,
        orchestratorAgentId: conversationDetail.orchestratorAgentId,
      }
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
    return () => {
      if (activeConversationId) {
        runStreamManager.disconnect(activeConversationId)
      }
    }
  }, [activeConversationId])

  useEffect(() => {
    if (!activeConversationId || !conversationDetail || !messagesQuery.data) return

    setConversationChatSpeakers(
      activeConversationId,
      conversationDetail.agents.map((agent) => agent.agentId)
    )

    const dataUpdatedAt = messagesQuery.dataUpdatedAt
    const lastHydratedAt = lastHydratedAtRef.current[activeConversationId]
    if (lastHydratedAt !== dataUpdatedAt) {
      lastHydratedAtRef.current[activeConversationId] = dataUpdatedAt
      startTransition(() => {
        hydrateTimelineFromReplay(
          activeConversationId,
          messagesQuery.data!.messages,
          messagesQuery.data!.timelineRuns,
          messagesQuery.data!.activeRun
        )
      })
    }

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
    messagesQuery.dataUpdatedAt,
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

  const handleSubmit = useCallback(async (input: ChatSubmitInput) => {
    if (!activeConversationId || !conversationDetail) return

    await submitWorkbenchMessage({
      activeConversationId,
      input,
      hasActiveRun: Boolean(
        runtimeState?.activeRuntimeRunId &&
          !isTerminalRunStatus(runtimeState.runStatus)
      ),
      setDraft,
      markRunSubmitted,
      failRunStart,
      notifyActiveRun: () => {
        toast.info("当前会话已有正在运行的回复")
      },
      notifyError: (message, code) => {
        toast.error(code ? `${code}: ${message}` : message)
      },
      uploadImage: conversationMessagesApi.uploadImage,
      sendMessage: conversationMessagesApi.send,
      onSuccess: async (result) => {
        queryClient.setQueryData(
          workbenchQueryKeys.conversations.messages(activeConversationId),
          result
        )
        hydrateTimelineFromReplay(
          activeConversationId,
          result.messages,
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
      },
    })
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

  const handleRegenerate = useCallback(async (messageId: string) => {
    if (!activeConversationId || !conversationDetail) return

    if (
      runtimeState?.activeRuntimeRunId &&
      !isTerminalRunStatus(runtimeState.runStatus)
    ) {
      toast.info("当前会话已有正在运行的回复")
      return
    }

    markRunSubmitted(activeConversationId)

    try {
      const result = await conversationMessagesApi.regenerate(
        activeConversationId,
        messageId
      )
      queryClient.setQueryData(
        workbenchQueryKeys.conversations.messages(activeConversationId),
        result
      )
      hydrateTimelineFromReplay(
        activeConversationId,
        result.messages,
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
      const message = err instanceof Error ? err.message : "重新生成失败"
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
  ])

  const handleCancelActiveRun = useCallback(async (
    runId?: string,
    options?: { fallbackToChat?: boolean }
  ) => {
    if (!activeConversationId) return

    const targetRunId = runId ?? runtimeState?.activeRuntimeRunId
    if (!targetRunId) {
      toast.info("当前没有可停止的回复")
      return
    }

    try {
      const result = await conversationMessagesApi.cancelRun(targetRunId)
      const terminalRunId = result.id || targetRunId
      const terminalStatus = getTerminalCancelStatus(result.status)
      applyRuntimeEvents(activeConversationId, [
        createLocalRunTerminalEvent(terminalRunId, result.runtimeId, terminalStatus),
      ])
      runStreamManager.disconnect(activeConversationId, "disconnected")
      void queryClient.invalidateQueries({
        queryKey: workbenchQueryKeys.conversations.messages(activeConversationId),
      })
      void queryClient.invalidateQueries({
        queryKey: workbenchQueryKeys.conversations.all,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "停止回答失败"
      const code = err instanceof ConversationMessageRequestError ? err.code : undefined
      if (options?.fallbackToChat) {
        applyRuntimeEvents(activeConversationId, [
          createLocalRunTerminalEvent(targetRunId, null, "cancelled"),
        ])
        runStreamManager.disconnect(activeConversationId, "disconnected")
        toast.info("无法确认原 Run 状态，已在本地跳过本轮问题等待")
        return
      }
      toast.error(code ? `${code}: ${message}` : message)
      throw err
    }
  }, [
    activeConversationId,
    applyRuntimeEvents,
    queryClient,
    runtimeState?.activeRuntimeRunId,
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

  const handleOpenWorkspaceTab = useCallback((tabType: SingletonTabId) => {
    if (!activeConversationId) return

    requestWorkspaceFocus({
      tabType,
      conversationId: activeConversationId,
      reason: "manual",
      reasonKey: `${tabType}:${activeConversationId}`,
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
                activeRunId={runtimeState?.activeRuntimeRunId ?? null}
                conversation={activeConversation}
                connectionStatus={runtimeState?.connectionStatus ?? "idle"}
                deploymentSnapshot={runtimeState?.deploymentSnapshot ?? null}
                draft={runtimeState?.draft ?? ""}
                isWorkspaceOpen={!isWorkspaceCollapsed}
                onCancelRun={handleCancelActiveRun}
                onDraftChange={handleDraftChange}
                onOpenWorkspaceTab={handleOpenWorkspaceTab}
                onRegenerate={handleRegenerate}
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
          defaultSize={"40%"}
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
  agentSummaries: AgentSummary[],
  context: {
    mode: ConversationDetail["mode"]
    orchestratorAgentId: string | null
  }
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
        role: member.role ?? resolveFallbackAgentRole(member.agentId, context),
        origin: agent?.origin,
        executorType: agent?.executorType,
        capabilities: agent?.capabilities ?? [],
        enabled: agent?.enabled,
        resolvedModel: agent?.resolvedModel,
      }
    })
}

function resolveFallbackAgentRole(
  agentId: string,
  context: {
    mode: ConversationDetail["mode"]
    orchestratorAgentId: string | null
  }
): ConversationAgentProfile["role"] {
  if (agentId === context.orchestratorAgentId || agentId === "orchestrator") {
    return "orchestrator"
  }
  return context.mode === "single" ? "primary" : "member"
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

function getTerminalCancelStatus(
  status: RuntimeRunStatus
): "completed" | "failed" | "cancelled" {
  return status === "completed" || status === "failed" || status === "cancelled"
    ? status
    : "cancelled"
}

function createLocalRunTerminalEvent(
  runId: string,
  runtimeRunId: string | null,
  status: "completed" | "failed" | "cancelled"
): RuntimeRunEvent {
  return {
    id: `local-run-terminal:${runId}:${status}:${crypto.randomUUID()}`,
    runId,
    runtimeRunId,
    type: `run.${status}`,
    timestamp: new Date().toISOString(),
    data: {
      status,
      reason: "client_cancel",
    },
  }
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
