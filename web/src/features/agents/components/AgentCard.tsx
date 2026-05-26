import { BotIcon } from "lucide-react"

import { Switch } from "@/components/animate-ui/components/radix/switch"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

import type { AgentSummary } from "../types"
import { AgentModelIcon } from "./AgentModelControl"

type AgentCardProps = {
  agent: AgentSummary
  onClick: () => void
  onToggleEnabled: (agentId: string, enabled: boolean) => void
  selected: boolean
}

const originLabels = {
  external: "外部",
  system: "系统",
  user: "用户",
}

export function AgentCard({
  agent,
  onClick,
  onToggleEnabled,
  selected,
}: AgentCardProps) {
  const canToggleEnabled = agent.origin === "user"

  return (
    <div
      aria-current={selected ? "true" : undefined}
      className={cn(
        "box-border flex w-full min-w-0 max-w-full cursor-pointer flex-col gap-2 overflow-hidden rounded-lg border border-transparent px-3 py-3 text-left transition-colors hover:bg-accent",
        selected && "border-primary/40 bg-accent"
      )}
      onClick={onClick}
      onKeyDown={(event) => {
        if (
          event.currentTarget === event.target &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault()
          onClick()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <BotIcon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{agent.name}</span>
          <span className="block truncate text-muted-foreground text-xs">
            {agent.description}
          </span>
        </span>
        {canToggleEnabled ? (
          <span
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Switch
              checked={agent.enabled}
              onCheckedChange={(checked) => onToggleEnabled(agent.id, checked)}
            />
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 items-center gap-2 overflow-hidden pl-10">
        <Badge variant="secondary">{originLabels[agent.origin]}</Badge>
        {agent.origin === "external" ? null : (
          <span className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
            <AgentModelIcon model={agent.resolvedModel} />
            <span className="truncate">
              {agent.resolvedModel?.modelName ?? "未绑定模型"}
            </span>
          </span>
        )}
      </span>
    </div>
  )
}
