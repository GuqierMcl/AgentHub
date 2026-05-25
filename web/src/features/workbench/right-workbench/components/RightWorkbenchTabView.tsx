import { Activity } from "react"

import { cn } from "@/lib/utils"

import type { TabInstance } from "@/store/tab-store"

import { BrowserPanel } from "./BrowserPanel"
import { CodeReviewPanel } from "./CodeReviewPanel"
import { DeployPreviewPanel } from "./DeployPreviewPanel"
import { FileBrowserPanel } from "./FileBrowserPanel"
import { TerminalPanel } from "./TerminalPanel"

type RightWorkbenchTabViewProps = {
  tabs: readonly TabInstance[]
  activeTabUid: string | null
  mountedTabUids: ReadonlySet<string>
}

function renderPanel(tab: TabInstance) {
  switch (tab.type) {
    case "review":
      return <CodeReviewPanel />
    case "files":
      return <FileBrowserPanel />
    case "deploy":
      return <DeployPreviewPanel />
    case "terminal":
      return <TerminalPanel title={tab.title} uid={tab.uid} />
    case "preview":
      return <BrowserPanel title={tab.title} uid={tab.uid} />
    default:
      return null
  }
}

export function RightWorkbenchTabView({
  tabs,
  activeTabUid,
  mountedTabUids,
}: RightWorkbenchTabViewProps) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {tabs.map((tab) => {
        const isActive = tab.uid === activeTabUid
        const shouldMount = mountedTabUids.has(tab.uid) || isActive

        if (!shouldMount) {
          return null
        }

        return (
          <Activity
            key={tab.uid}
            mode={isActive ? "visible" : "hidden"}
            name={`right-workbench-${tab.uid}`}
          >
            <div
              aria-hidden={!isActive}
              className={cn(
                "absolute inset-0 min-h-0",
                isActive ? "flex" : "hidden"
              )}
              data-tab-uid={tab.uid}
            >
              {renderPanel(tab)}
            </div>
          </Activity>
        )
      })}
    </div>
  )
}
