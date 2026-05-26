import { CpuIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import type { AgentDetail, AgentResolvedModel } from "../types"

type AgentModelIconProps = {
  model?: AgentResolvedModel
}

type AgentModelControlProps = {
  agent: AgentDetail
  disabled?: boolean
  onConfigure?: () => void
}

export function AgentModelIcon({ model }: AgentModelIconProps) {
  if (!model) {
    return <CpuIcon className="size-4 shrink-0 text-muted-foreground" />
  }

  return (
    <img
      alt={model.providerName}
      className="size-4 shrink-0"
      key={`${model.providerId}/${model.modelId}`}
      onError={(event) => {
        event.currentTarget.style.display = "none"
      }}
      src={`https://models.dev/logos/${model.providerId}.svg`}
    />
  )
}

export function AgentModelControl({
  agent,
  disabled = false,
  onConfigure,
}: AgentModelControlProps) {
  const content = (
    <>
      <AgentModelIcon model={agent.resolvedModel} />
      <span className="min-w-0 flex-1 truncate text-left">
        {agent.resolvedModel?.modelName ?? "未绑定模型"}
      </span>
      {onConfigure ? (
        <span className="shrink-0 text-muted-foreground text-xs">
          {disabled ? "启用后配置" : "点击配置"}
        </span>
      ) : null}
    </>
  )

  if (!onConfigure) {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted p-3 text-sm">
        {content}
      </div>
    )
  }

  return (
    <Button
      className={cn("h-auto w-full justify-start gap-2 rounded-lg px-3 py-3")}
      disabled={disabled}
      onClick={onConfigure}
      type="button"
      variant="outline"
    >
      {content}
    </Button>
  )
}
