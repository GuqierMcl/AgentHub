import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { ProviderSummary, ProviderProtocol } from "../../types"

const protocolLabels: Record<ProviderProtocol, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openai_compatible: "OpenAI 兼容",
}

type ProviderCardProps = {
  provider: ProviderSummary
  onConnect: () => void
  onDisconnect?: () => void
}

export function ProviderCard({ provider, onConnect, onDisconnect }: ProviderCardProps) {
  const isCustom = provider.source === "custom"
  const isConnected = provider.has_api_key

  return (
    <div className="flex items-center justify-between rounded-xl bg-muted/30 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <img
            alt={provider.id}
            className="size-4 shrink-0"
            src={`https://models.dev/logos/${provider.id}.svg`}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none"
            }}
          />
          <span className="text-sm font-medium">{provider.name}</span>
          <Badge
            variant="outline"
            className={cn(
              "text-xs",
              isCustom
                ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400"
            )}
          >
            {isCustom ? "自定义" : protocolLabels[provider.api_protocol]}
          </Badge>
          {isConnected && (
            <Badge variant="outline" className="text-xs">
              API 密钥
            </Badge>
          )}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {provider.model_count} 个模型 · {provider.api_base || "-"}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {isConnected ? (
          <>
            <Button variant="ghost" size="sm" onClick={onConnect}>
              编辑
            </Button>
            <Button variant="ghost" size="sm" onClick={onDisconnect}>
              断开连接
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={onConnect}>
            + 连接
          </Button>
        )}
      </div>
    </div>
  )
}