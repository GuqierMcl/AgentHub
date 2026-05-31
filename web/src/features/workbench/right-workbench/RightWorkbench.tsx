import { useCallback } from "react"

import { useTabStore } from "@/store/tab-store"

import type { RuntimeRunStatus } from "../api/runtime-runs"
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

  const handleOpenTab = useCallback(
    (type: Parameters<typeof openTab>[0]) => {
      if (type === "preview") {
        openTab("preview", undefined, { source: "manual" })
      } else {
        openTab(type)
      }
    },
    [openTab]
  )

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
          onCloseTab={closeTab}
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
