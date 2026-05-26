import type { ComponentType } from "react"
import type { LucideIcon } from "lucide-react"
import { BotIcon, MessageSquareIcon } from "lucide-react"

import { AgentsWorkspace } from "@/features/agents/AgentsWorkspace"
import { ChatWorkspace } from "@/features/workbench/ChatWorkspace"

export type AppModuleId = "chat" | "agents"

export type AppModuleDefinition = {
  component: ComponentType
  icon: LucideIcon
  id: AppModuleId
  label: string
  title: string
}

export const appModules: readonly AppModuleDefinition[] = [
  {
    component: ChatWorkspace,
    icon: MessageSquareIcon,
    id: "chat",
    label: "聊天",
    title: "聊天 | AgentHub",
  },
  {
    component: AgentsWorkspace,
    icon: BotIcon,
    id: "agents",
    label: "智能体",
    title: "智能体 | AgentHub",
  },
]
