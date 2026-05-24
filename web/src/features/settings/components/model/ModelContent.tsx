import { useEffect, useState, useCallback, useMemo } from "react"
import { SearchIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { runtimeApi } from "../../api/runtime"
import type { ProviderDetail, ModelResponse } from "../../types"
import { ModelCard } from "./ModelCard"

export function ModelContent() {
  const [providers, setProviders] = useState<ProviderDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [toggling, setToggling] = useState<string | null>(null)

  const fetchProviders = useCallback(async () => {
    try {
      const data = await runtimeApi.getProviders()
      const details = await Promise.all(
        data.providers.map((p) => runtimeApi.getProvider(p.id))
      )
      setProviders(details)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取模型列表失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  const handleToggle = useCallback(
    async (providerId: string, modelId: string, enabled: boolean) => {
      const key = `${providerId}/${modelId}`
      setToggling(key)
      try {
        const result = await runtimeApi.updateModelConfig(
          providerId,
          modelId,
          { enabled }
        )
        setProviders((prev) =>
          prev.map((p) => {
            if (p.id !== providerId) return p
            return {
              ...p,
              models: {
                ...p.models,
                [modelId]: result,
              },
            }
          })
        )
      } catch {
        // toggle error is non-critical, ignore
      } finally {
        setToggling(null)
      }
    },
    []
  )

  const connectedProviders = useMemo(
    () => providers.filter((p) => p.has_api_key),
    [providers]
  )

  const connectedModels = useMemo(() => {
    const models: Array<{ model: ModelResponse; providerName: string }> = []
    for (const p of connectedProviders) {
      for (const m of Object.values(p.models)) {
        if (m.enabled) {
          models.push({ model: m, providerName: p.name })
        }
      }
    }
    return models
  }, [connectedProviders])

  const filteredProviders = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return providers
    return providers
      .map((p) => {
        const filteredModels = Object.values(p.models).filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            m.id.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q)
        )
        return { ...p, models: Object.fromEntries(filteredModels.map((m) => [m.id, m])) }
      })
      .filter((p) => Object.keys(p.models).length > 0)
  }, [providers, search])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        加载中...
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">模型</h3>
        <div className="rounded-xl bg-muted/30 px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold">模型</h3>

      <div className="space-y-3">
        <span className="text-sm font-medium">
          配置已连接提供商的可用模型
        </span>
        {connectedModels.length === 0 ? (
          <div className="rounded-xl bg-muted/30 px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {connectedProviders.length === 0
                ? "未配置提供商"
                : "暂无已启用的模型"}
            </p>
          </div>
        ) : (
          connectedModels.map(({ model, providerName }) => (
            <ModelCard
              key={`${providerName}-${model.id}`}
              model={model}
              providerName={providerName}
              onToggle={(enabled) =>
                handleToggle(
                  providers.find((p) =>
                    Object.values(p.models).some((m) => m.id === model.id)
                  )?.id || "",
                  model.id,
                  enabled
                )
              }
              disabled={toggling === `${providers.find((p) => Object.values(p.models).some((m) => m.id === model.id))?.id}/${model.id}`}
            />
          ))
        )}
      </div>

      <div className="space-y-3">
        <span className="text-sm font-medium">全部模型</span>
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索模型"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="space-y-4">
          {filteredProviders.map((provider) => (
            <div key={provider.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{provider.name}</span>
                <span className="text-xs text-muted-foreground">
                  {Object.values(provider.models).length} 个模型
                </span>
              </div>
              <div className="space-y-2">
                {Object.values(provider.models).map((model) => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    providerName={provider.name}
                    onToggle={(enabled) =>
                      handleToggle(provider.id, model.id, enabled)
                    }
                    disabled={toggling === `${provider.id}/${model.id}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}