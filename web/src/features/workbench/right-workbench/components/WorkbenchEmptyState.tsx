import {
  FileSearchIcon,
  FolderOpenIcon,
  GlobeIcon,
  ListTodoIcon,
  RocketIcon,
  SquareTerminalIcon,
} from "lucide-react"

import type { TabType } from "@/store/tab-store"
import { TabCard } from "./TabCard"

type WorkbenchEmptyStateProps = {
  onOpenTab: (type: TabType) => void
}

const tabCards: { type: TabType; title: string; description: string; icon: typeof ListTodoIcon }[] = [
  { type: "files", icon: FolderOpenIcon, title: "文件", description: "浏览项目文件" },
  { type: "preview", icon: GlobeIcon, title: "浏览器", description: "打开网站" },
  { type: "review", icon: FileSearchIcon, title: "审查", description: "查看代码更改" },
  { type: "terminal", icon: SquareTerminalIcon, title: "终端", description: "启动交互式 shell" },
  { type: "conversation-status", icon: ListTodoIcon, title: "会话状态", description: "查看计划与运行状态" },
  { type: "deploy", icon: RocketIcon, title: "部署预览", description: "查看部署状态" },
]

export function WorkbenchEmptyState({ onOpenTab }: WorkbenchEmptyStateProps) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="flex w-full max-w-lg flex-wrap items-stretch justify-center gap-4">
        {tabCards.map((card) => (
          <TabCard
            key={card.type}
            icon={card.icon}
            title={card.title}
            description={card.description}
            onClick={() => onOpenTab(card.type)}
          />
        ))}
      </div>
    </div>
  )
}
