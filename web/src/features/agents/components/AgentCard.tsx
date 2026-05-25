import { TrashIcon, BotIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { AgentSummary } from "../types"

type AgentCardProps = {
  agent: AgentSummary
  onClick: () => void
  onDelete: () => void
}

const originLabels: Record<string, string> = {
  system: "系统",
  user: "用户",
  external: "外部",
}

export function AgentCard({ agent, onClick, onDelete }: AgentCardProps) {
  const canDelete = agent.origin === "user" && !agent.readonly

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick() }}
      className={cn(
        "group relative flex flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors",
        "hover:bg-accent/50 cursor-pointer"
      )}
    >
      {canDelete && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <TrashIcon className="size-4" />
        </Button>
      )}

      <div className="flex items-center gap-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <BotIcon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{agent.name}</div>
        </div>
      </div>

      <p className="line-clamp-2 text-xs text-muted-foreground">
        {agent.description}
      </p>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary" className="text-[10px]">
          {originLabels[agent.origin] ?? agent.origin}
        </Badge>
        {agent.enabled ? (
          <Badge variant="default" className="text-[10px] bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
            已启用
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            已禁用
          </Badge>
        )}
        {agent.resolvedModel && (
          <Badge variant="outline" className="text-[10px]">
            {agent.resolvedModel.modelName}
          </Badge>
        )}
      </div>
    </div>
  )
}
