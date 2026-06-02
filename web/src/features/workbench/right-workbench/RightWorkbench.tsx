import { useCallback, useEffect, useMemo, useRef } from "react"
import { toast } from "sonner"

import { useTabStore, type TerminalTabPayload } from "@/store/tab-store"

import type { RuntimeRunStatus } from "../api/runtime-runs"
import { terminalApi } from "../api/terminal"
import type { RunConnectionStatus } from "../store/workbench-store"
import type { Conversation } from "../types"
import { RightWorkbenchTabBar } from "./components/RightWorkbenchTabBar"
import { RightWorkbenchTabView } from "./components/RightWorkbenchTabView"
import { WorkbenchEmptyState } from "./components/WorkbenchEmptyState"

type RightWorkbenchProps = {
  conversation: Conversation | null
  connectionStatus: RunConnectionStatus
  runStatus: RuntimeRunStatus | "idle" | "submitted"
}

function deriveWorkspaceLabel(workspacePath: string): string {
  if (!workspacePath) return ""
  const segments = workspacePath.replace(/\\/g, "/").split("/").filter(Boolean)
  return segments[segments.length - 1] ?? workspacePath
}

function deriveWorkspaceId(workspacePath: string): string {
  if (!workspacePath) return ""
  return `workspace_${workspacePath.replace(/[^a-zA-Z0-9_-]/g, "_")}`
}

export function RightWorkbench({
  conversation,
  connectionStatus,
  runStatus,
}: RightWorkbenchProps) {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabUid = useTabStore((s) => s.activeTabUid)
  const mountedTabUids = useTabStore((s) => s.mountedTabUids)
  const openTab = useTabStore((s) => s.openTab)
  const closeTab = useTabStore((s) => s.closeTab)
  const activateTab = useTabStore((s) => s.activateTab)

  const workspaceLabel = useMemo(
    () => deriveWorkspaceLabel(conversation?.workspace ?? ""),
    [conversation?.workspace]
  )
  const workspaceId = useMemo(
    () => deriveWorkspaceId(conversation?.workspace ?? ""),
    [conversation?.workspace]
  )

  const handleOpenTab = useCallback(
    (type: Parameters<typeof openTab>[0]) => {
      if (type === "preview") {
        openTab("preview", undefined, { source: "manual" })
      } else if (type === "terminal") {
        if (!conversation?.workspace) {
          toast.info("未设置工作区")
          return
        }
        const payload: TerminalTabPayload = {
          conversationId: conversation.id,
          workspaceId,
          workspaceLabel,
        }
        openTab("terminal", undefined, payload)
      } else {
        openTab(type)
      }
    },
    [openTab, conversation, workspaceId, workspaceLabel]
  )

  const handleCloseTab = useCallback(
    (uid: string) => {
      const tab = tabs.find((item) => item.uid === uid)

      if (
        tab?.type === "terminal" &&
        tab.payload &&
        "workspaceId" in tab.payload &&
        typeof tab.payload.sessionId === "string"
      ) {
        terminalApi
          .closeSession(tab.payload.conversationId, tab.payload.sessionId)
          .catch(() => {
            // Best-effort cleanup.
          })
      }

      closeTab(uid)
    },
    [closeTab, tabs]
  )

  const tabsRef = useRef(tabs)
  useEffect(() => {
    tabsRef.current = tabs
  })

  useEffect(() => {
    if (!conversation?.workspace) return

    let cancelled = false

    terminalApi.listSessions(conversation.id).then((res) => {
      if (cancelled) return

      for (const session of res.data) {
        if (session.status === "closed" || session.status === "error") continue

        const payload: TerminalTabPayload = {
          conversationId: conversation.id,
          workspaceId,
          workspaceLabel,
          sessionId: session.sessionId,
        }

        const hasTab = tabsRef.current.some(
          (t) =>
            t.type === "terminal" &&
            t.payload &&
            "sessionId" in t.payload &&
            (t.payload as TerminalTabPayload).sessionId === session.sessionId,
        )

        if (!hasTab) {
          openTab("terminal", undefined, payload)
        }
      }
    }).catch(() => {
      // Session listing is best-effort
    })

    return () => {
      cancelled = true
    }
  }, [conversation?.id, conversation?.workspace, openTab, workspaceId, workspaceLabel])

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col border-border border-l bg-background">
      <div className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-border border-b px-4">
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-sm!">产物工作台</h2>
          <p className="truncate text-muted-foreground text-xs!">
            内联产物、预览、编辑与部署
          </p>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <RightWorkbenchTabBar
          activeTabUid={activeTabUid}
          onCloseTab={handleCloseTab}
          onActivateTab={activateTab}
          onOpenTab={handleOpenTab}
          tabs={tabs}
        />
        {tabs.length === 0 ? (
          <WorkbenchEmptyState />
        ) : (
          <RightWorkbenchTabView
            activeTabUid={activeTabUid}
            connectionStatus={connectionStatus}
            conversation={conversation}
            mountedTabUids={mountedTabUids}
            runStatus={runStatus}
            tabs={tabs}
          />
        )}
      </div>
    </aside>
  )
}
