import { SettingsIcon } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import type { CurrentUser } from "../types"

type CurrentUserBarProps = {
  collapsed: boolean
  onOpenSettings: () => void
  user: CurrentUser
}

export function CurrentUserBar({ collapsed, onOpenSettings, user }: CurrentUserBarProps) {
  const settingsButton = (
    <Button aria-label="用户设置" onClick={onOpenSettings} size="icon-sm" type="button" variant="ghost">
      <SettingsIcon />
    </Button>
  )

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-3 border-border border-t p-3",
        collapsed && "flex-col gap-2"
      )}
    >
      <Avatar size="lg">
        <AvatarFallback>{user.initials}</AvatarFallback>
      </Avatar>

      {collapsed ? null : (
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-medium leading-tight">
            {user.name}
          </div>
          <div className="truncate text-muted-foreground text-sm">
            {user.plan}
          </div>
        </div>
      )}

      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{settingsButton}</TooltipTrigger>
          <TooltipContent side="right">用户设置</TooltipContent>
        </Tooltip>
      ) : (
        settingsButton
      )}
    </div>
  )
}
