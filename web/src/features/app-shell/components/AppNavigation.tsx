import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { currentUser } from "../mock-data"
import type { AppModuleDefinition, AppModuleId } from "../app-modules"
import { CurrentUserBar } from "./CurrentUserBar"

type AppNavigationProps = {
  activeModuleId: AppModuleId
  collapsed: boolean
  modules: readonly AppModuleDefinition[]
  onOpenSettings: () => void
  onSelectModule: (moduleId: AppModuleId) => void
  onToggleCollapsed: () => void
}

export function AppNavigation({
  activeModuleId,
  collapsed,
  modules,
  onOpenSettings,
  onSelectModule,
  onToggleCollapsed,
}: AppNavigationProps) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-border border-r bg-sidebar">
      <div
        className={cn(
          "flex shrink-0 items-center gap-3 px-4 pt-4 pb-5",
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
            aria-label="收起导航"
            onClick={onToggleCollapsed}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <PanelLeftCloseIcon />
          </Button>
        )}
      </div>

      <nav aria-label="主导航" className="flex min-h-0 flex-1 flex-col gap-1 px-3">
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="展开导航"
                className="w-full"
                onClick={onToggleCollapsed}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <PanelLeftOpenIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">展开导航</TooltipContent>
          </Tooltip>
        ) : null}

        {modules.map((module) => {
          const Icon = module.icon
          const selected = module.id === activeModuleId
          const button = (
            <Button
              aria-current={selected ? "page" : undefined}
              aria-label={module.label}
              className={cn(
                "w-full",
                !collapsed && "justify-start",
                selected && "bg-secondary text-secondary-foreground"
              )}
              key={module.id}
              onClick={() => onSelectModule(module.id)}
              size={collapsed ? "icon" : "sm"}
              type="button"
              variant="ghost"
            >
              <Icon
                data-icon="inline-start"
                size={collapsed ? 22 : 16}
                className="![&_svg]:size-auto"
              />
              {collapsed ? null : <span>{module.label}</span>}
            </Button>
          )

          if (!collapsed) {
            return button
          }

          return (
            <Tooltip key={module.id}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side="right">{module.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </nav>

      <CurrentUserBar
        collapsed={collapsed}
        onOpenSettings={onOpenSettings}
        user={currentUser}
      />
    </aside>
  )
}
