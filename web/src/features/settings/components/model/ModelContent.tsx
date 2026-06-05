import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { SearchIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { runtimeApi } from "../../api/runtime"
import type { ProviderDetail, ProviderProtocol, SystemModelSettingsResponse } from "../../types"
import { ModelCard } from "./ModelCard"

const protocolLabels: Record<ProviderProtocol, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openai_compatible: "OpenAI 兼容",
}

let fetchPromise: Promise<ProviderDetail[]> | null = null
const UNSET_SYSTEM_MODEL = "__unset_system_model__"

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
  const [systemModelSetting, setSystemModelSetting] = useState<SystemModelSettingsResponse>({ status: "unset" })
  const [savingSystemModel, setSavingSystemModel] = useState(false)
  const expandedInitRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchConnectedProviders(),
      runtimeApi.getSystemDefaultModel(),
    ]).then(([details, setting]) => {
      if (cancelled) return
      setProviders(details)
      setSystemModelSetting(setting)
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
        const refreshedSetting = await runtimeApi.getSystemDefaultModel().catch(() => null)
        if (refreshedSetting) {
          setSystemModelSetting(refreshedSetting)
        }
        toast.success("模型配置已更新")
      } catch {
        toast.error("操作失败，请重试")
      } finally {
        setToggling(null)
      }
    },
    []
  )

  const systemDefaultModels = useMemo(() => {
    return providers.flatMap((provider) => {
      if (!provider.enabled || !provider.has_api_key) {
        return []
      }

      return Object.values(provider.models)
        .filter((model) => model.enabled && model.capabilities.supports_tools)
        .map((model) => ({
          value: createModelValue(provider.id, model.id),
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.id,
          modelName: model.name,
        }))
    })
  }, [providers])

  const selectedSystemModel = systemModelSetting.systemDefaultModel
    ? createModelValue(
        systemModelSetting.systemDefaultModel.providerId,
        systemModelSetting.systemDefaultModel.modelId
      )
    : UNSET_SYSTEM_MODEL
  const selectedSystemModelExists = systemDefaultModels.some((model) => model.value === selectedSystemModel)

  const handleSystemModelChange = useCallback(async (value: string) => {
    setSavingSystemModel(true)
    try {
      const nextSetting = value === UNSET_SYSTEM_MODEL
        ? await runtimeApi.clearSystemDefaultModel()
        : await runtimeApi.updateSystemDefaultModel(parseModelValue(value))

      setSystemModelSetting(nextSetting)
      toast.success(value === UNSET_SYSTEM_MODEL ? "系统默认模型已清除" : "系统默认模型已更新")
    } catch (err) {
      const refreshedSetting = await runtimeApi.getSystemDefaultModel().catch(() => null)
      if (refreshedSetting) {
        setSystemModelSetting(refreshedSetting)
      }
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSavingSystemModel(false)
    }
  }, [])

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
      <div className="space-y-3 rounded-xl bg-muted/30 px-4 py-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">系统默认模型</p>
            <p className="text-xs text-muted-foreground">
              用于系统内置智能体、系统内置任务智能体，以及智能体绑定模型调用失败后的首包前降级。
            </p>
          </div>
          {systemModelSetting.status === "configured" && (
            <span className="w-fit rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
              已设置
            </span>
          )}
          {systemModelSetting.status === "invalid" && (
            <span className="w-fit rounded-md bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
              配置失效
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            value={selectedSystemModel}
            onValueChange={handleSystemModelChange}
            disabled={savingSystemModel || systemDefaultModels.length === 0}
          >
            <SelectTrigger className="h-9 min-w-0 flex-1">
              <SelectValue placeholder={systemDefaultModels.length === 0 ? "暂无可用模型" : "选择系统默认模型"} />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={UNSET_SYSTEM_MODEL}>未设置</SelectItem>
              {!selectedSystemModelExists && systemModelSetting.systemDefaultModel && (
                <SelectItem value={selectedSystemModel}>
                  {systemModelSetting.systemDefaultModel.providerId}/{systemModelSetting.systemDefaultModel.modelId}
                </SelectItem>
              )}
              {providers.map((provider) => {
                const models = systemDefaultModels.filter((model) => model.providerId === provider.id)
                if (models.length === 0) return null
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
                    {models.map((model) => (
                      <SelectItem key={model.value} value={model.value}>
                        {model.modelName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )
              })}
            </SelectContent>
          </Select>
          {systemModelSetting.systemDefaultModel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0"
              onClick={() => void handleSystemModelChange(UNSET_SYSTEM_MODEL)}
              disabled={savingSystemModel}
            >
              <XIcon className="mr-1 size-4" />
              清除
            </Button>
          )}
        </div>
        {systemModelSetting.status === "invalid" && systemModelSetting.invalidReason && (
          <p className="text-xs text-destructive">
            当前模型不可用：{systemModelSetting.invalidReason.message}
          </p>
        )}
        {systemDefaultModels.length === 0 && (
          <p className="text-xs text-muted-foreground">
            连接并启用支持工具调用的模型后，可设置系统默认模型。
          </p>
        )}
      </div>
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
                      <img
                        alt={provider.id}
                        className="size-4 shrink-0"
                        src={`https://models.dev/logos/${provider.id}.svg`}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none"
                        }}
                      />
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

function createModelValue(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`
}

function parseModelValue(value: string): { providerId: string; modelId: string } {
  const separatorIndex = value.indexOf("/")
  return {
    providerId: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1),
  }
}
