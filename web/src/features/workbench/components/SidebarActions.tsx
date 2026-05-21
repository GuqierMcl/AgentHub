import { BotIcon, PanelLeftOpenIcon, PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type SidebarActionsProps = {
  collapsed: boolean
  onToggleCollapsed: () => void
}

type ActionButtonProps = {
  collapsed: boolean
  icon: React.ReactNode
  label: string
  onClick?: () => void
}

function ActionButton({ collapsed, icon, label, onClick }: ActionButtonProps) {
  const button = (
    <Button
      aria-label={label}
      className={collapsed ? "w-full" : "w-full justify-start"}
      onClick={onClick}
      size={collapsed ? "icon-sm" : "sm"}
      type="button"
      variant="ghost"
    >
      {icon}
      {collapsed ? null : <span>{label}</span>}
    </Button>
  )

  if (!collapsed) {
    return button
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

export function SidebarActions({
  collapsed,
  onToggleCollapsed,
}: SidebarActionsProps) {
  return (
    <div className="flex shrink-0 flex-col gap-1 px-3 pt-3 pb-2">
      {collapsed ? (
        <ActionButton
          collapsed={collapsed}
          icon={<PanelLeftOpenIcon data-icon="inline-start" />}
          label="展开侧栏"
          onClick={onToggleCollapsed}
        />
      ) : null}
      <ActionButton
        collapsed={collapsed}
        icon={<PlusIcon data-icon="inline-start" />}
        label="新聊天"
      />
      <ActionButton
        collapsed={collapsed}
        icon={<BotIcon data-icon="inline-start" />}
        label="智能体"
      />
    </div>
  )
}
