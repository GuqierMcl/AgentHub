import {
  FileSearchIcon,
  FolderOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  RocketIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

import type { Artifact } from "../types"
import { CodeReviewPanel } from "./components/CodeReviewPanel"
import { DeployPreviewPanel } from "./components/DeployPreviewPanel"
import { FileBrowserPanel } from "./components/FileBrowserPanel"
import { RightWorkbenchTabBar } from "./components/RightWorkbenchTabBar"
import { RightWorkbenchTabView } from "./components/RightWorkbenchTabView"
import type {
  RightWorkbenchTabId,
  WorkbenchTabDefinition,
  WorkbenchTabPanel,
} from "./types"

const rightWorkbenchTabs = [
  {
    badge: "3",
    description: "Diff、问题和修复建议",
    icon: FileSearchIcon,
    id: "review",
    label: "代码审查",
  },
  {
    description: "文件树和二次编辑草稿",
    icon: FolderOpenIcon,
    id: "files",
    label: "文件浏览",
  },
  {
    description: "预览、日志和一键部署入口",
    icon: RocketIcon,
    id: "deploy",
    label: "部署预览",
  },
] satisfies WorkbenchTabDefinition[]

type RightWorkbenchProps = {
  activeTab: RightWorkbenchTabId
  collapsed: boolean
  mountedTabs: ReadonlySet<RightWorkbenchTabId>
  onActiveTabChange: (tabId: RightWorkbenchTabId) => void
  onToggleCollapsed: () => void
  selectedArtifact: Artifact | null
  selectedFilePath: string
  onSelectedFilePathChange: (path: string) => void
  previewTarget: string
}

export function RightWorkbench({
  activeTab,
  collapsed,
  mountedTabs,
  onActiveTabChange,
  onToggleCollapsed,
  selectedArtifact,
  selectedFilePath,
  onSelectedFilePathChange,
  previewTarget,
}: RightWorkbenchProps) {
  const panels: WorkbenchTabPanel[] = [
    {
      content: <CodeReviewPanel selectedArtifact={selectedArtifact} />,
      id: "review",
    },
    {
      content: (
        <FileBrowserPanel
          onSelectFilePath={onSelectedFilePathChange}
          selectedFilePath={selectedFilePath}
        />
      ),
      id: "files",
    },
    {
      content: (
        <DeployPreviewPanel
          previewTarget={previewTarget}
          selectedArtifact={selectedArtifact}
        />
      ),
      id: "deploy",
    },
  ]

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col border-border border-l bg-background">
      <div
        className={cn(
          "flex min-h-16 shrink-0 items-center gap-3 border-border border-b",
          collapsed ? "justify-center px-2" : "justify-between px-4"
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Button
            aria-label={collapsed ? "展开产物工作台" : "收起产物工作台"}
            onClick={onToggleCollapsed}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {collapsed ? <PanelRightOpenIcon /> : <PanelRightCloseIcon />}
          </Button>
          {collapsed ? null : (
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-sm">产物工作台</h2>
              <p className="truncate text-muted-foreground text-xs">
                内联产物、预览、编辑与部署
              </p>
            </div>
          )}
        </div>
        {collapsed ? null : (
          <Badge className="shrink-0" variant="outline">
            cached
          </Badge>
        )}
      </div>

      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          collapsed && "hidden"
        )}
      >
        <Tabs
          className="flex h-full min-h-0 flex-1 flex-col gap-0"
          onValueChange={(value) =>
            onActiveTabChange(value as RightWorkbenchTabId)
          }
          value={activeTab}
        >
          <RightWorkbenchTabBar tabs={rightWorkbenchTabs} />
          <RightWorkbenchTabView
            activeTab={activeTab}
            mountedTabs={mountedTabs}
            panels={panels}
          />
        </Tabs>
      </div>
    </aside>
  )
}

export type { RightWorkbenchTabId } from "./types"
