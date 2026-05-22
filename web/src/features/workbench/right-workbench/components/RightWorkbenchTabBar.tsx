import { Badge } from "@/components/ui/badge"
import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

import type { WorkbenchTabDefinition } from "../types"

type RightWorkbenchTabBarProps = {
  tabs: WorkbenchTabDefinition[]
}

export function RightWorkbenchTabBar({ tabs }: RightWorkbenchTabBarProps) {
  return (
    <div className="flex shrink-0 items-center gap-1 border-border border-b px-2 py-1.5">
      <TabsList
        className="h-auto min-w-0 flex-1 justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0"
        variant="line"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon

          return (
            <TabsTrigger
              className={cn(
                "h-8 flex-none rounded-md px-2 text-xs",
                "data-active:bg-muted data-active:after:opacity-0"
              )}
              key={tab.id}
              value={tab.id}
            >
              <Icon className="size-3.5" />
              <span>{tab.label}</span>
              {tab.badge ? (
                <Badge className="h-4 px-1 text-[10px]" variant="secondary">
                  {tab.badge}
                </Badge>
              ) : null}
            </TabsTrigger>
          )
        })}
      </TabsList>
    </div>
  )
}
