import { useState } from "react"
import { ChevronDownIcon, FolderKanbanIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type WorkspaceCapabilityCardProps = {
  title: string
  subtitle: string
  skillCount: number
  mcpCount: number
  children: React.ReactNode
}

export function WorkspaceCapabilityCard({
  title,
  subtitle,
  skillCount,
  mcpCount,
  children,
}: WorkspaceCapabilityCardProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          <FolderKanbanIcon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="secondary" className="text-xs">
            Skill {skillCount}
          </Badge>
          <Badge variant="secondary" className="text-xs">
            MCP {mcpCount}
          </Badge>
          <Button
            aria-label={collapsed ? "展开工作区" : "折叠工作区"}
            onClick={() => setCollapsed((value) => !value)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <ChevronDownIcon
              className={cn(
                "size-4 transition-transform",
                collapsed && "-rotate-90"
              )}
            />
          </Button>
        </div>
      </div>
      {collapsed ? null : (
        <div className="p-4">
          {children}
        </div>
      )}
    </section>
  )
}
