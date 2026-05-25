import {
  PanelLeftCloseIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

import { currentUser } from "../mock-data"
import type { Conversation } from "../types"
import { ConversationListItem } from "./ConversationListItem"
import { CurrentUserBar } from "./CurrentUserBar"
import { SidebarActions } from "./SidebarActions"

type ConversationSidebarProps = {
  conversations: Conversation[]
  activeConversationId: string
  collapsed: boolean
  onSelectConversation: (conversationId: string) => void
  onOpenSettings: () => void
  onOpenAgents: () => void
  onToggleCollapsed: () => void
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  collapsed,
  onSelectConversation,
  onOpenSettings,
  onOpenAgents,
  onToggleCollapsed,
}: ConversationSidebarProps) {
  return (
    <aside
      className={cn(
        "flex min-h-0 min-w-0 flex-col border-border border-r bg-sidebar",
        collapsed && "items-stretch"
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-3 px-4 pt-4 pb-3",
          collapsed ? "justify-center px-3" : "justify-between"
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg">
            <img src="/logo.png" alt="AgentHub" className="size-full object-cover" />
          </div>
          {collapsed ? null : (
            <div className="min-w-0">
              <div className="truncate text-base font-semibold">AgentHub</div>
              <div className="truncate text-muted-foreground text-xs">
                多 Agent 协作工作台
              </div>
            </div>
          )}
        </div>

        {collapsed ? null : (
          <Button
            aria-label="收起侧栏"
            onClick={onToggleCollapsed}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <PanelLeftCloseIcon />
          </Button>
        )}
      </div>

      <SidebarActions
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        onOpenAgents={onOpenAgents}
      />

      {collapsed ? (
        <div className="min-h-0 flex-1" />
      ) : (
        <>
          <div className="px-4 pt-2 pb-2">
            <div className="text-muted-foreground text-xs font-medium">
              对话列表
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-1 px-2 pb-3">
              {conversations.map((conversation) => (
                <ConversationListItem
                  collapsed={collapsed}
                  conversation={conversation}
                  key={conversation.id}
                  onSelect={onSelectConversation}
                  selected={conversation.id === activeConversationId}
                />
              ))}
            </div>
          </ScrollArea>
        </>
      )}

      <CurrentUserBar collapsed={collapsed} onOpenSettings={onOpenSettings} user={currentUser} />
    </aside>
  )
}
