import { useEffect, useCallback, useRef, useState } from "react"
import { usePanelRef } from "react-resizable-panels"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

import { useTabStore } from "@/store/tab-store"

import { RightWorkbench } from "../right-workbench/RightWorkbench"
import { ChatPanel } from "./ChatPanel"
import type { Conversation } from "../types"

type WorkbenchContentLayoutProps = {
  activeConversation: Conversation
}

export function WorkbenchContentLayout({
  activeConversation,
}: WorkbenchContentLayoutProps) {
  const workspacePanelRef = usePanelRef()
  const [isWorkspaceCollapsed, setIsWorkspaceCollapsed] = useState(true)
  const tabs = useTabStore((s) => s.tabs)
  const hasTabsRef = useRef(false)

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
            <ChatPanel
              conversation={activeConversation}
              isWorkspaceOpen={!isWorkspaceCollapsed}
              onToggleWorkspace={handleToggleWorkspaceCollapsed}
            />
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
