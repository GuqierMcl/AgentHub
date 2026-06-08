import {
  CircleAlertIcon,
  FolderIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { InfiniteLinearProgress } from "@/components/ui/infinite-linear-progress"
import {
  AnimatedPanelLeftCloseIcon,
  AnimatedPanelLeftOpenIcon,
} from "@/components/ui/panel-left-controls"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  singletonTabIds,
  tabMeta,
  type SingletonTabId,
} from "@/store/tab-store"

import type { Conversation, ConversationAgentProfile } from "../types"
import type { RuntimeRunStatus } from "../api/runtime-runs"
import type { RunConnectionStatus } from "../store/workbench-store"
import { getConversationAgentProfiles } from "../utils/conversation-agents"
import { ConversationAvatar } from "./AgentAvatar"
import { useAvatarOverrides } from "@/features/agents/hooks/use-avatar-overrides"

type ChatHeaderProps = {
  conversation: Conversation
  runStatus: RuntimeRunStatus | "idle" | "submitted"
  connectionStatus: RunConnectionStatus
  isWorkspaceOpen: boolean
  onOpenWorkspaceTab: (tabType: SingletonTabId) => void
  onToggleWorkspace: () => void
}

export function ChatHeader({
  connectionStatus,
  conversation,
  isWorkspaceOpen,
  onOpenWorkspaceTab,
  onToggleWorkspace,
  runStatus,
}: ChatHeaderProps) {
  const conversationAgents = getConversationAgentProfiles(conversation)
  const agentNames = conversationAgents.map((agent) => agent.name)
  const workspaceLabel = getWorkspaceLabel(conversation.workspace)
  const missingModelCount = conversationAgents.filter(needsModelBinding).length
  const showRunProgress = shouldShowRunProgress(runStatus, connectionStatus)
  const { data: avatarManifest } = useAvatarOverrides()
  const overrides = avatarManifest?.agents ?? {}

  return (
    <header className="relative flex min-h-20 shrink-0 items-center justify-between gap-4 border-border border-b bg-background px-5">
      <div className="flex min-w-0 items-center gap-3">
        <ConversationAvatar conversation={conversation} overrides={overrides} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-base font-semibold">
              {conversation.title}
            </h2>
            <Badge
              variant={conversation.mode === "group" ? "default" : "secondary"}
            >
              {conversation.mode === "group" ? "群聊" : "单聊"}
            </Badge>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
            <span className="min-w-0 truncate">
              {agentNames.join(" · ")}
            </span>
            <span className="shrink-0">
              {conversationAgents.length} 个智能体
            </span>
            {workspaceLabel ? (
              <span className="flex min-w-0 items-center gap-1 truncate">
                <FolderIcon className="size-3 shrink-0" />
                <span className="truncate">{workspaceLabel}</span>
              </span>
            ) : null}
            {missingModelCount > 0 ? (
              <Badge className="gap-1" variant="outline">
                <CircleAlertIcon data-icon="inline-start" />
                {missingModelCount} 个未绑定模型
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ButtonGroup>
          {singletonTabIds.map((tabType) => {
            const meta = tabMeta[tabType]
            const Icon = meta.icon

            return (
              <Tooltip key={tabType}>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={`打开${meta.label}`}
                    onClick={() => onOpenWorkspaceTab(tabType)}
                    size="icon-sm"
                    type="button"
                    variant="outline"
                  >
                    <Icon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{meta.label}</TooltipContent>
              </Tooltip>
            )
          })}
        </ButtonGroup>
        <Button
          aria-label={isWorkspaceOpen ? "收起产物工作台" : "展开产物工作台"}
          onClick={onToggleWorkspace}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {isWorkspaceOpen ? <AnimatedPanelLeftOpenIcon /> : <AnimatedPanelLeftCloseIcon />}
        </Button>
      </div>
      {showRunProgress ? (
        <InfiniteLinearProgress
          aria-label="当前会话正在运行"
          className="absolute inset-x-0 bottom-0 h-0.5 rounded-none bg-muted/60"
        />
      ) : null}
    </header>
  )
}

function getWorkspaceLabel(workspace: string): string {
  if (!workspace) return ""
  return `${workspace.split("\\").pop() ?? workspace} · 工作区`
}

function needsModelBinding(agent: ConversationAgentProfile): boolean {
  return (
    agent.enabled !== false &&
    (agent.executorType === "ai-sdk" || agent.executorType === "orchestrator") &&
    !agent.resolvedModel
  )
}

function shouldShowRunProgress(
  runStatus: RuntimeRunStatus | "idle" | "submitted",
  connectionStatus: RunConnectionStatus
): boolean {
  return (
    connectionStatus !== "error" &&
    (runStatus === "submitted" ||
      runStatus === "queued" ||
      runStatus === "running" ||
      runStatus === "waiting_approval" ||
      runStatus === "waiting_input")
  )
}
