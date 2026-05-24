import { EyeIcon, WrenchIcon, LightbulbIcon, ThermometerIcon } from "lucide-react"
import type { ModelCapabilities } from "../../types"

type ModelCapabilitiesProps = {
  capabilities: ModelCapabilities
}

export function ModelCapabilityIcons({ capabilities }: ModelCapabilitiesProps) {
  return (
    <div className="flex items-center gap-1.5">
      {capabilities.supports_vision && (
        <span
          title="视觉"
          className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs"
        >
          <EyeIcon className="size-3" />
          <span>视觉</span>
        </span>
      )}
      {capabilities.supports_tools && (
        <span
          title="工具"
          className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs"
        >
          <WrenchIcon className="size-3" />
          <span>工具</span>
        </span>
      )}
      {capabilities.supports_reasoning && (
        <span
          title="推理"
          className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs"
        >
          <LightbulbIcon className="size-3" />
          <span>推理</span>
        </span>
      )}
      {capabilities.temperature && (
        <span
          title="温度"
          className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs"
        >
          <ThermometerIcon className="size-3" />
          <span>温度</span>
        </span>
      )}
    </div>
  )
}