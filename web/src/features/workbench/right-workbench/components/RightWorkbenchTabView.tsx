import { Activity } from "react"

import { cn } from "@/lib/utils"

import type { RightWorkbenchTabId, WorkbenchTabPanel } from "../types"

type RightWorkbenchTabViewProps = {
  activeTab: RightWorkbenchTabId
  mountedTabs: ReadonlySet<RightWorkbenchTabId>
  panels: WorkbenchTabPanel[]
}

export function RightWorkbenchTabView({
  activeTab,
  mountedTabs,
  panels,
}: RightWorkbenchTabViewProps) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {panels.map((panel) => {
        const isActive = panel.id === activeTab
        const shouldMount = mountedTabs.has(panel.id) || isActive

        if (!shouldMount) {
          return null
        }

        return (
          <Activity
            key={panel.id}
            mode={isActive ? "visible" : "hidden"}
            name={`right-workbench-${panel.id}`}
          >
            <div
              aria-hidden={!isActive}
              className={cn(
                "absolute inset-0 min-h-0",
                isActive ? "flex" : "hidden"
              )}
              data-tab-id={panel.id}
            >
              {panel.content}
            </div>
          </Activity>
        )
      })}
    </div>
  )
}
