import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { runtimeApi } from "../../settings/api/runtime"
import { agentsApi } from "../api/agents"
import type { ProviderDetail } from "../../settings/types"
import type { AgentSummary } from "../types"

type ModelBindingDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: AgentSummary | null
  onBound: () => void
}

export function ModelBindingDialog({ open, onOpenChange, agent, onBound }: ModelBindingDialogProps) {
  const [connectedProviders, setConnectedProviders] = useState<ProviderDetail[]>([])
  const [loading, setLoading] = useState(false)
  const [binding, setBinding] = useState(false)
  const [selectedModel, setSelectedModel] = useState("")

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setSelectedModel(agent?.resolvedModel ? `${agent.resolvedModel.providerId}/${agent.resolvedModel.modelId}` : "")
      setLoading(true)
      runtimeApi.getProviders()
        .then((data) => {
          const connectedIds = data.providers
            .filter((p) => p.has_api_key)
            .map((p) => p.id)
          return Promise.all(connectedIds.map((id) => runtimeApi.getProvider(id)))
        })
        .then((details) => {
          if (!cancelled) setConnectedProviders(details)
        })
        .catch(() => {
          if (!cancelled) setConnectedProviders([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 0)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [open, agent])

  const handleBindModel = useCallback(async (value: string) => {
    if (!agent || !value) return
    const [providerId, modelId] = value.split("/")
    if (!providerId || !modelId) return
    setSelectedModel(value)
    setBinding(true)
    try {
      const provider = connectedProviders.find((p) => p.id === providerId)
      const model = provider?.models[modelId]
      const modelName = model?.name ?? modelId
      await agentsApi.bindModel(agent.id, { providerId, modelId })
      toast.success(`已绑定 ${modelName}`)
      onBound()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "绑定失败")
    } finally {
      setBinding(false)
    }
  }, [agent, connectedProviders, onBound])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent from="top" className="w-[400px]">
        <DialogHeader>
          <DialogTitle>模型绑定 - {agent?.name}</DialogTitle>
          <DialogDescription>
            选择该智能体使用的模型
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Select value={selectedModel} onValueChange={handleBindModel} disabled={loading || binding}>
            <SelectTrigger className="h-8 text-xs w-full">
              <SelectValue placeholder={loading ? "加载中..." : "选择模型"} />
            </SelectTrigger>
            <SelectContent position="popper">
              {connectedProviders.map((provider) => {
                const enabledModels = Object.values(provider.models).filter((m) => m.enabled)
                if (enabledModels.length === 0) return null
                return (
                  <SelectGroup key={provider.id}>
                    <SelectLabel className="flex items-center gap-1.5">
                      <img
                        alt={provider.id}
                        className="size-3.5 shrink-0"
                        src={`https://models.dev/logos/${provider.id}.svg`}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none"
                        }}
                      />
                      {provider.name}
                    </SelectLabel>
                    {enabledModels.map((model) => (
                      <SelectItem key={`${provider.id}/${model.id}`} value={`${provider.id}/${model.id}`}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )
              })}
            </SelectContent>
          </Select>
        </div>
      </DialogContent>
    </Dialog>
  )
}
