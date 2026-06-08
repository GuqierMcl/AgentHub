import { Activity, useCallback, useMemo, useState } from "react"
import { SearchIcon } from "lucide-react"

import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AnimatedRefreshCwIcon } from "@/components/ui/refresh-controls"
import { cn } from "@/lib/utils"

import {
  appendMountedPluginConfigQuery,
  buildPluginConfigQueryKey,
  createMountedPluginConfigQuery,
} from "./plugin-config-activity-state"
import { ScopeSelector } from "./components/ScopeSelector"
import { PluginConfigQueryView } from "./PluginConfigQueryView"
import type { CapabilityScope } from "./types"

export function PluginConfigWorkspace() {
  const [activeTab, setActiveTab] = useState("skill")
  const [scope, setScope] = useState<CapabilityScope>("global")
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [searchQuery, setSearchQuery] = useState("")
  const [mountedQueries, setMountedQueries] = useState(() => [
    createMountedPluginConfigQuery("global"),
  ])
  const [refreshRequest, setRefreshRequest] = useState<{
    queryKey: string
    token: number
  } | null>(null)
  const [loadingByQueryKey, setLoadingByQueryKey] = useState<Record<string, boolean>>({})

  const activeQueryKey = useMemo(
    () => buildPluginConfigQueryKey(scope, conversationId),
    [conversationId, scope],
  )

  const handleScopeChange = useCallback((
    nextScope: CapabilityScope,
    nextConversationId?: string,
  ) => {
    const nextQuery = createMountedPluginConfigQuery(nextScope, nextConversationId)
    setScope(nextScope)
    setConversationId(nextConversationId)
    setMountedQueries((current) =>
      appendMountedPluginConfigQuery(current, nextQuery)
    )
  }, [])

  const handleRefresh = useCallback(() => {
    setRefreshRequest({
      queryKey: activeQueryKey,
      token: Date.now(),
    })
  }, [activeQueryKey])

  const handleLoadingChange = useCallback((queryKey: string, loading: boolean) => {
    setLoadingByQueryKey((current) => {
      if (current[queryKey] === loading) {
        return current
      }
      return {
        ...current,
        [queryKey]: loading,
      }
    })
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">插件配置</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              查看已发现的 Skill 和 MCP Server 配置
            </p>
          </div>
          <Button
            onClick={handleRefresh}
            disabled={loadingByQueryKey[activeQueryKey] === true}
            size="xs"
            type="button"
            variant="secondary"
          >
            <AnimatedRefreshCwIcon
              data-icon="inline-start"
              spinning={loadingByQueryKey[activeQueryKey] === true}
            />
            刷新
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex shrink-0 items-center justify-between gap-4">
            <TabsList className="relative h-9">
              <TabsTrigger value="skill" className="text-xs">Skill</TabsTrigger>
              <TabsTrigger value="mcp" className="text-xs">MCP</TabsTrigger>
            </TabsList>
            <div className="flex-1">
              <ScopeSelector
                scope={scope}
                onScopeChange={handleScopeChange}
                conversationId={conversationId}
              />
            </div>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索..."
                className="h-8 w-[180px] rounded-3xl pl-7 text-xs"
              />
            </div>
          </div>

          <div className="relative mt-4 min-h-0 flex-1 overflow-hidden">
            {mountedQueries.map((query) => {
              const isActive = query.queryKey === activeQueryKey

              return (
                <Activity
                  key={query.queryKey}
                  mode={isActive ? "visible" : "hidden"}
                  name={`plugin-config-query-${query.queryKey}`}
                >
                  <div
                    aria-hidden={!isActive}
                    className={cn(
                      "absolute inset-0 min-h-0 min-w-0 overflow-hidden",
                      isActive ? "flex" : "hidden",
                    )}
                  >
                    <PluginConfigQueryView
                      scope={query.scope}
                      conversationId={query.conversationId}
                      searchQuery={searchQuery}
                      refreshToken={
                        refreshRequest?.queryKey === query.queryKey
                          ? refreshRequest.token
                          : 0
                      }
                      onLoadingChange={(loading) =>
                        handleLoadingChange(query.queryKey, loading)
                      }
                    />
                  </div>
                </Activity>
              )
            })}
          </div>
        </Tabs>
      </div>
    </div>
  )
}
