import { PlusIcon, XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

import "./RightWorkbenchTabBar.css"

import {
  type TabInstance,
  type TabType,
  multiTabIds,
  singletonTabIds,
  tabMeta,
  useTabStore,
} from "@/store/tab-store"

type RightWorkbenchTabBarProps = {
  tabs: readonly TabInstance[]
  activeTabUid: string | null
  onActivateTab: (uid: string) => void
  onCloseTab: (uid: string) => void
  onOpenTab: (type: TabType) => void
}

export function RightWorkbenchTabBar({
  tabs,
  activeTabUid,
  onActivateTab,
  onCloseTab,
  onOpenTab,
}: RightWorkbenchTabBarProps) {
  const isSingletonOpen = useTabStore((s) => s.isSingletonOpen)

  return (
    <div className="flex w-full min-w-0 max-w-full shrink-0 items-center gap-1 overflow-hidden border-border border-b px-2 py-1.5">
      <div className="right-workbench-tab-scroll min-w-0 max-w-full flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-8 w-max items-center gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = tab.uid === activeTabUid

            return (
              <button
                className={cn(
                  "group/tab relative flex h-8 max-w-48 min-w-0 flex-none items-center gap-1.5 rounded-md px-2.5 text-xs! transition-colors",
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
                key={tab.uid}
                onClick={() => onActivateTab(tab.uid)}
                type="button"
              >
                <Icon className="size-4 shrink-0" />
                <span className="min-w-0 max-w-36 truncate">{tab.title}</span>
                <span
                  className={cn(
                    "-mr-1 flex size-4 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity",
                    isActive
                      ? "hover:bg-muted-foreground/20 group-hover/tab:opacity-100"
                      : "group-hover/tab:opacity-70"
                  )}
                  onClick={(event) => {
                    event.stopPropagation()
                    onCloseTab(tab.uid)
                  }}
                  role="button"
                  tabIndex={-1}
                >
                  <XIcon className="size-3" />
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="打开新标签"
            className="size-7 flex-none"
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <PlusIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuLabel>单例标签</DropdownMenuLabel>
          <DropdownMenuGroup>
            {singletonTabIds.map((type) => {
              const meta = tabMeta[type]
              const Icon = meta.icon
              const isOpen = isSingletonOpen(type)

              return (
                <DropdownMenuItem
                  key={type}
                  onSelect={() => onOpenTab(type)}
                >
                  <Icon />
                  <span className="flex-1">{meta.label}</span>
                  {isOpen ? (
                    <Badge className="ml-auto" variant="secondary">
                      已打开
                    </Badge>
                  ) : null}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>多实例标签</DropdownMenuLabel>
          <DropdownMenuGroup>
            {multiTabIds.map((type) => {
              const meta = tabMeta[type]
              const Icon = meta.icon

              return (
                <DropdownMenuItem
                  key={type}
                  onSelect={() => onOpenTab(type)}
                >
                  <Icon />
                  <span>{meta.label}</span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
