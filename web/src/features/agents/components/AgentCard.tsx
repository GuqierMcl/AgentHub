import { CpuIcon, TrashIcon, BotIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/animate-ui/components/radix/switch"
import type { AgentSummary } from "../types"

type AgentCardProps = {
  agent: AgentSummary
  onClick: () => void
  onDelete: () => void
  onToggleEnabled: (agentId: string, enabled: boolean) => void
  onManageModel: (agent: AgentSummary) => void
}

const originLabels: Record<string, string> = {
  system: "系统",
  user: "用户",
  external: "外部",
}

export function AgentCard({ agent, onClick, onDelete, onToggleEnabled, onManageModel }: AgentCardProps) {
  const canDelete = agent.origin === "user" && !agent.readonly
  const canToggleEnabled = agent.origin === "user"

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

      {agent.origin !== "external" && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          {agent.resolvedModel ? (
            <img
              alt={agent.resolvedModel.providerId}
              className="size-4 shrink-0"
              src={`https://models.dev/logos/${agent.resolvedModel.providerId}.svg`}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none"
              }}
            />
          ) : (
            <CpuIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            {agent.resolvedModel ? (
              <span className="truncate text-xs font-medium">
                {agent.resolvedModel.modelName}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">未绑定模型</span>
            )}
          </div>
          <Button
            variant="ghost"
            size="xs"
            onClick={(e) => { e.stopPropagation(); onManageModel(agent) }}
          >
            配置
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="flex flex-wrap gap-1.5 flex-1">
          <Badge variant="secondary" className="text-[10px]">
            {originLabels[agent.origin] ?? agent.origin}
          </Badge>
        </div>
        {canToggleEnabled && (
          <div onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={agent.enabled}
              onCheckedChange={(checked) => onToggleEnabled(agent.id, checked)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
