import {
  FolderIcon,
  MoreHorizontalIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PinIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"


import { getAgentById } from "../mock-data"
import type { Agent, Conversation } from "../types"
import { ConversationAvatar } from "./AgentAvatar"

type ChatHeaderProps = {
  conversation: Conversation
  isWorkspaceOpen: boolean
  onToggleWorkspace: () => void
}

export function ChatHeader({
  conversation,
  isWorkspaceOpen,
  onToggleWorkspace,
}: ChatHeaderProps) {
  const conversationAgents = conversation.agentIds
    .map((id) => getAgentById(id))
    .filter((agent): agent is Agent => Boolean(agent))

  return (
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-border border-b bg-background px-5">
          <div className="flex min-w-0 items-center gap-3">
              <ConversationAvatar conversation={conversation} />
              <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                      <h2 className="truncate text-base font-semibold">
                          {conversation.title}
                      </h2>
                      <Badge
                          variant={
                              conversation.mode === "group"
                                  ? "default"
                                  : "secondary"
                          }
                      >
                          {conversation.mode === "group" ? "群聊" : "单聊"}
                      </Badge>
                  </div>
                  <p className="truncate text-muted-foreground text-xs">
                      {conversationAgents.map((agent) => agent.name).join(", ")}
                  </p>
                  <p className="flex items-center gap-1 truncate text-muted-foreground text-xs">
                      <FolderIcon className="size-3 shrink-0" />
                      {conversation.workspace.split("\\").pop()} · 工作区
                  </p>
              </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">

              <Button
                  className="hidden sm:inline-flex"
                  size="sm"
                  type="button"
                  variant="outline"
              >
                  <PinIcon data-icon="inline-start" />
                  Pin
              </Button>
              <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                      <Button
                          aria-label="对话操作"
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                      >
                          <MoreHorizontalIcon />
                      </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                          <DropdownMenuItem>查看上下文</DropdownMenuItem>
                          <DropdownMenuItem>管理 Agent</DropdownMenuItem>
                          <DropdownMenuItem>归档会话</DropdownMenuItem>
                      </DropdownMenuGroup>
                  </DropdownMenuContent>
              </DropdownMenu>
              <Button
                  aria-label={
                      isWorkspaceOpen ? "收起产物工作台" : "展开产物工作台"
                  }
                  onClick={onToggleWorkspace}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
              >
                  {isWorkspaceOpen ? (
                      <PanelRightCloseIcon />
                  ) : (
                      <PanelRightOpenIcon />
                  )}
              </Button>
          </div>
      </header>
  );
}
