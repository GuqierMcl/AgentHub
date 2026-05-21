import { useCallback, useState } from "react"
import type { PanelSize } from "react-resizable-panels"
import { usePanelRef } from "react-resizable-panels"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

import { RightWorkbench } from "../right-workbench/RightWorkbench"
import type { RightWorkbenchTabId } from "../right-workbench/RightWorkbench"
import type { Artifact } from "../types"
import { ChatPanel } from "./ChatPanel"
import type { Conversation } from "../types"

type WorkbenchContentLayoutProps = {
  activeConversation: Conversation
  activeRightTab: RightWorkbenchTabId
  mountedRightTabs: ReadonlySet<RightWorkbenchTabId>
  onActiveRightTabChange: (tabId: RightWorkbenchTabId) => void
  onOpenArtifact: (artifact: Artifact) => void
  onSelectedFilePathChange: (path: string) => void
  previewTarget: string
  selectedArtifact: Artifact | null
  selectedFilePath: string
}

export function WorkbenchContentLayout({
  activeConversation,
  activeRightTab,
  mountedRightTabs,
  onActiveRightTabChange,
  onOpenArtifact,
  onSelectedFilePathChange,
  previewTarget,
  selectedArtifact,
  selectedFilePath,
}: WorkbenchContentLayoutProps) {
  const workspacePanelRef = usePanelRef()
  const [isWorkspaceCollapsed, setIsWorkspaceCollapsed] = useState(false)

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

  const handleWorkspaceResize = useCallback((size: PanelSize) => {
    setIsWorkspaceCollapsed(size.inPixels <= 72 || size.asPercentage <= 1)
  }, [])

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
          defaultSize={64}
          minSize={28}
        >
          <ChatPanel
            conversation={activeConversation}
            onOpenArtifact={onOpenArtifact}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel
          className="h-full min-h-0 min-w-0"
          id="workspace"
          collapsedSize="3.5rem"
          collapsible
          defaultSize={36}
          minSize="23rem"
          onResize={handleWorkspaceResize}
          panelRef={workspacePanelRef}
        >
          <RightWorkbench
            activeTab={activeRightTab}
            collapsed={isWorkspaceCollapsed}
            mountedTabs={mountedRightTabs}
            onActiveTabChange={onActiveRightTabChange}
            onSelectedFilePathChange={onSelectedFilePathChange}
            onToggleCollapsed={handleToggleWorkspaceCollapsed}
            previewTarget={previewTarget}
            selectedArtifact={selectedArtifact}
            selectedFilePath={selectedFilePath}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
