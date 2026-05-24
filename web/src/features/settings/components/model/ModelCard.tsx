import { Switch } from "@/components/animate-ui/components/radix/switch"
import { ModelCapabilityIcons } from "./ModelCapabilities"
import type { ModelResponse } from "../../types"

function formatContextLength(length: number): string {
  if (length >= 1_000_000) {
    return `${(length / 1_000_000).toFixed(1)}M`
  }
  if (length >= 1_000) {
    return `${Math.round(length / 1_000)}K`
  }
  return String(length)
}

function formatCost(cost: { input: number; output: number }): string {
  if (cost.input === 0 && cost.output === 0) return ""
  const inputStr = `$${cost.input.toFixed(2)}`
  const outputStr = `$${cost.output.toFixed(2)}`
  return `${inputStr}/1M 输入 · ${outputStr}/1M 输出`
}

type ModelCardProps = {
  model: ModelResponse
  onToggle: (enabled: boolean) => void
  disabled?: boolean
}

export function ModelCard({
  model,
  onToggle,
  disabled,
}: ModelCardProps) {
  const costText = formatCost(model.cost)

  return (
    <div className="flex items-center justify-between rounded-xl bg-background px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{model.name}</span>
          <span className="text-xs text-muted-foreground">{model.id}</span>
        </div>
        <div className="mt-1.5">
          <ModelCapabilityIcons capabilities={model.capabilities} />
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{formatContextLength(model.context_length)} 上下文</span>
          {costText && <span>{costText}</span>}
        </div>
      </div>
      <Switch
        checked={model.enabled}
        onCheckedChange={onToggle}
        disabled={disabled}
      />
    </div>
  )
}