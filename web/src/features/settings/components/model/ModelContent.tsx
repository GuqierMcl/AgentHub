import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { SearchIcon } from "lucide-react"
import { toast } from "sonner"

import { Input } from "@/components/ui/input"
import { runtimeApi } from "../../api/runtime"
import type { ProviderDetail, ProviderProtocol } from "../../types"
import { ModelCard } from "./ModelCard"

const protocolLabels: Record<ProviderProtocol, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openai_compatible: "OpenAI 兼容",
}

let fetchPromise: Promise<ProviderDetail[]> | null = null

async function fetchConnectedProviders(): Promise<ProviderDetail[]> {
  if (fetchPromise) return fetchPromise
  fetchPromise = (async () => {
    try {
      const data = await runtimeApi.getProviders()
      const connectedIds = data.providers
        .filter((p) => p.has_api_key)
        .map((p) => p.id)
      const details = await Promise.all(
        connectedIds.map((id) => runtimeApi.getProvider(id))
      )
      return details
    } finally {
      fetchPromise = null
    }
  })()
  return fetchPromise
}

export function ModelContent() {
  const [providers, setProviders] = useState<ProviderDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [toggling, setToggling] = useState<string | null>(null)
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set())
  const expandedInitRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    fetchConnectedProviders().then((details) => {
      if (cancelled) return
      setProviders(details)
      setError(null)
      if (!expandedInitRef.current && details.length > 0) {
        expandedInitRef.current = true
        setExpandedProviders(new Set([details[0].id]))
      }
      setLoading(false)
    }).catch((err) => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : "获取模型列表失败")
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const toggleExpand = useCallback((providerId: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev)
      if (next.has(providerId)) {
        next.delete(providerId)
      } else {
        next.add(providerId)
      }
      return next
    })
  }, [])

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
        toast.success("模型配置已更新")
      } catch {
        toast.error("操作失败，请重试")
      } finally {
        setToggling(null)
      }
    },
    []
  )

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
        <div className="rounded-xl bg-muted/30 px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    )
  }

  const hasConnectedProviders = providers.length > 0

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索模型"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {!hasConnectedProviders ? (
          <div className="rounded-xl bg-muted/30 px-4 py-8 text-center">
            <p className="text-sm font-medium">尚未连接提供商</p>
            <p className="mt-1 text-xs text-muted-foreground">
              在供应商页面连接提供商后，即可在此处管理其可用模型。
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredProviders.map((provider) => {
              const models = Object.values(provider.models)
              const enabledCount = models.filter((m) => m.enabled).length
              const isExpanded = expandedProviders.has(provider.id)

              return (
                <div key={provider.id} className="rounded-xl bg-muted/30">
                  <button
                    type="button"
                    onClick={() => toggleExpand(provider.id)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{provider.name}</span>
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {protocolLabels[provider.api_protocol]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {enabledCount}/{models.length} 个模型已启用
                      </span>
                    </div>
                    <svg
                      className={`size-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {isExpanded && (
                    <div className="space-y-2 px-4 pb-3">
                      {models.map((model) => (
                        <ModelCard
                          key={model.id}
                          model={model}
                          onToggle={(enabled) =>
                            handleToggle(provider.id, model.id, enabled)
                          }
                          disabled={toggling === `${provider.id}/${model.id}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}