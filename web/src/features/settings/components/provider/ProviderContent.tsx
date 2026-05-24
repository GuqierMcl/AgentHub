import { useEffect, useState, useCallback, useMemo } from "react"
import { RefreshCwIcon, PlusIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { runtimeApi } from "../../api/runtime"
import type { ProviderSummary } from "../../types"
import { ProviderCard } from "./ProviderCard"
import { ConnectProviderDialog } from "./ConnectProviderDialog"
import { AddCustomProviderDialog } from "./AddCustomProviderDialog"

let providersCache: ProviderSummary[] | null = null
let providersFetchPromise: Promise<ProviderSummary[]> | null = null

async function fetchProvidersData(): Promise<ProviderSummary[]> {
  if (providersCache) return providersCache
  if (providersFetchPromise) return providersFetchPromise
  providersFetchPromise = (async () => {
    try {
      const data = await runtimeApi.getProviders()
      providersCache = data.providers
      return data.providers
    } finally {
      providersFetchPromise = null
    }
  })()
  return providersFetchPromise
}

function invalidateProvidersCache() {
  providersCache = null
}

export function ProviderContent() {
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [connectTarget, setConnectTarget] = useState<ProviderSummary | null>(null)
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const [addCustomOpen, setAddCustomOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchProvidersData()
      .then((data) => {
        if (cancelled) return
        setProviders(data)
        setError(null)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "获取供应商列表失败")
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const refetchProviders = useCallback(async () => {
    invalidateProvidersCache()
    try {
      const data = await fetchProvidersData()
      setProviders(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取供应商列表失败")
    }
  }, [])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await runtimeApi.refreshCatalog()
      await refetchProviders()
    } catch {
      // catalog refresh error is non-critical
    } finally {
      setRefreshing(false)
    }
  }, [refetchProviders])

  const handleConnected = useCallback(() => {
    setConnectDialogOpen(false)
    setTimeout(() => setConnectTarget(null), 300)
    refetchProviders()
  }, [refetchProviders])

  const handleCustomCreated = useCallback(() => {
    setAddCustomOpen(false)
    refetchProviders()
  }, [refetchProviders])

  const handleDisconnect = useCallback(async (providerId: string) => {
    try {
      await runtimeApi.updateProviderConfig(providerId, {
        api_key: "",
        enabled: false,
      })
      refetchProviders()
    } catch {
      // disconnect error is non-critical
    }
  }, [refetchProviders])

  const connectedIds = useMemo(
    () => new Set(providers.filter((p) => p.has_api_key).map((p) => p.id)),
    [providers]
  )

  const connectedProviders = useMemo(
    () => providers.filter((p) => p.has_api_key),
    [providers]
  )

  const allProviders = useMemo(() => {
    let list = providers.filter((p) => !connectedIds.has(p.id))
    const q = search.toLowerCase()
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q)
      )
    }
    return list
  }, [providers, connectedIds, search])

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
      <h3 className="text-base font-semibold">供应商</h3>
        <div className="rounded-xl bg-muted/30 px-4 py-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
        <h3 className="text-base font-semibold">供应商</h3>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">已连接的提供商</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCwIcon className={refreshing ? "animate-spin" : ""} />
              刷新目录
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAddCustomOpen(true)}
            >
              <PlusIcon />
              添加自定义供应商
            </Button>
          </div>
        </div>
        {connectedProviders.length === 0 ? (
          <div className="rounded-xl bg-muted/30 px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">尚未连接提供商</p>
            <p className="mt-1 text-xs text-muted-foreground">
              点击下方供应商的"连接"按钮开始配置
            </p>
          </div>
        ) : (
          connectedProviders.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              onConnect={() => {
                setConnectTarget(p)
                setConnectDialogOpen(true)
              }}
              onDisconnect={() => handleDisconnect(p.id)}
            />
          ))
        )}
      </div>

      <div className="space-y-3">
        <span className="text-sm font-medium">全部提供商</span>
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索提供商"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="space-y-2">
          {allProviders.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              onConnect={() => {
                setConnectTarget(p)
                setConnectDialogOpen(true)
              }}
            />
          ))}
        </div>
      </div>

      <ConnectProviderDialog
        provider={connectTarget}
        open={connectDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setConnectDialogOpen(false)
            setTimeout(() => setConnectTarget(null), 300)
          }
        }}
        onConnected={handleConnected}
      />

      <AddCustomProviderDialog
        open={addCustomOpen}
        onOpenChange={setAddCustomOpen}
        onCreated={handleCustomCreated}
      />
    </div>
  )
}