import { EyeIcon, WrenchIcon, LightbulbIcon } from "lucide-react"
import type { ModelCapabilities } from "../../types"

type ModelCapabilitiesProps = {
  capabilities: ModelCapabilities
}

export function ModelCapabilityIcons({ capabilities }: ModelCapabilitiesProps) {
  return (
    <div className="flex items-center gap-1.5">
      {capabilities.supports_vision && (
        <span title="视觉" className="text-muted-foreground">
          <EyeIcon className="size-3.5" />
        </span>
      )}
      {capabilities.supports_tools && (
        <span title="工具" className="text-muted-foreground">
          <WrenchIcon className="size-3.5" />
        </span>
      )}
      {capabilities.supports_reasoning && (
        <span title="推理" className="text-muted-foreground">
          <LightbulbIcon className="size-3.5" />
        </span>
      )}
    </div>
  )
}