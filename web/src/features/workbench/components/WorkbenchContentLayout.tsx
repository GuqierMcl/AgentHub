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
          defaultSize={36}
          minSize={18}
        >
          <RightWorkbench
            activeTab={activeRightTab}
            mountedTabs={mountedRightTabs}
            onActiveTabChange={onActiveRightTabChange}
            onSelectedFilePathChange={onSelectedFilePathChange}
            previewTarget={previewTarget}
            selectedArtifact={selectedArtifact}
            selectedFilePath={selectedFilePath}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
