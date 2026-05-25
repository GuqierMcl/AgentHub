import { PanelRightOpenIcon } from "lucide-react"

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

import { useTabStore } from "@/store/tab-store"

export function WorkbenchEmptyState() {
  const openTab = useTabStore((s) => s.openTab)

  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PanelRightOpenIcon />
        </EmptyMedia>
        <EmptyTitle>暂无打开的标签</EmptyTitle>
        <EmptyDescription>
          点击上方 + 按钮打开产物标签
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <button
          className="text-muted-foreground text-xs hover:text-foreground"
          onClick={() => openTab("review")}
          type="button"
        >
          或点击此处打开代码审查
        </button>
      </EmptyContent>
    </Empty>
  )
}
