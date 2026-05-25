
import { useTabStore } from "@/store/tab-store"

import { RightWorkbenchTabBar } from "./components/RightWorkbenchTabBar"
import { RightWorkbenchTabView } from "./components/RightWorkbenchTabView"
import { WorkbenchEmptyState } from "./components/WorkbenchEmptyState"

export function RightWorkbench() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabUid = useTabStore((s) => s.activeTabUid)
  const mountedTabUids = useTabStore((s) => s.mountedTabUids)
  const openTab = useTabStore((s) => s.openTab)
  const closeTab = useTabStore((s) => s.closeTab)
  const activateTab = useTabStore((s) => s.activateTab)

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col border-border border-l bg-background">

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <RightWorkbenchTabBar
          activeTabUid={activeTabUid}
          onCloseTab={closeTab}
          onActivateTab={activateTab}
          onOpenTab={openTab}
          tabs={tabs}
        />
        {tabs.length === 0 ? (
          <WorkbenchEmptyState />
        ) : (
          <RightWorkbenchTabView
            activeTabUid={activeTabUid}
            mountedTabUids={mountedTabUids}
            tabs={tabs}
          />
        )}
      </div>
    </aside>
  )
}
