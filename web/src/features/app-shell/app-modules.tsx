import type { ComponentType } from "react"

import { AgentsWorkspace } from "@/features/agents/AgentsWorkspace"
import { ChatWorkspace } from "@/features/workbench/ChatWorkspace"
import { PluginConfigWorkspace } from "@/features/plugin-config/PluginConfigWorkspace"
import { BotMessageSquareIcon } from "@/components/ui/bot-message-square"
import { AtomIcon } from "@/components/ui/atom"
import { PuzzleIcon } from "@/components/ui/puzzle"

export type AppModuleId = "chat" | "agents" | "plugin-config"

export type AppModuleDefinition = {
  component: ComponentType
  icon: ComponentType<{ className?: string; size?: number }>
  id: AppModuleId
  label: string
  title: string
}

export const appModules: readonly AppModuleDefinition[] = [
  {
    component: ChatWorkspace,
    icon: BotMessageSquareIcon,
    id: "chat",
    label: "聊天",
    title: "聊天 | AgentHub",
  },
  {
    component: AgentsWorkspace,
    icon: AtomIcon,
    id: "agents",
    label: "智能体",
    title: "智能体 | AgentHub",
  },
  {
    component: PluginConfigWorkspace,
    icon: PuzzleIcon,
    id: "plugin-config",
    label: "插件配置",
    title: "插件配置 | AgentHub",
  },
]
