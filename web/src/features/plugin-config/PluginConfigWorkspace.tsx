import { useCallback, useEffect, useMemo, useState } from "react"
import { SearchIcon } from "lucide-react"
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { AnimatedRefreshCwIcon } from "@/components/ui/refresh-controls"
import { capabilitiesApi } from "./api/capabilities"
import { SkillGrid } from "./components/SkillGrid"
import { McpGrid } from "./components/McpGrid"
import { ScopeSelector } from "./components/ScopeSelector"
import type { CapabilitiesResponse, CapabilityScope } from "./types"

export function PluginConfigWorkspace() {
  const [activeTab, setActiveTab] = useState("skill")
  const [scope, setScope] = useState<CapabilityScope>("global")
  const [conversationId, setConversationId] = useState<string | undefined>()

  const [data, setData] = useState<CapabilitiesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  const fetchData = useCallback(async () => {
    if (scope !== "global" && !conversationId) return

    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const result = await capabilitiesApi.fetch(scope, conversationId)
      setData(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : "加载失败"
      if (isWorkspaceNotice(message)) {
        setNotice(message)
      } else {
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }, [scope, conversationId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchData() }, [fetchData])

  const handleScopeChange = useCallback(
    (newScope: CapabilityScope, newConversationId?: string) => {
      setScope(newScope)
      setConversationId(newConversationId)
      setData(null)
      setNotice(null)
    },
    []
  )

  const handleRefresh = useCallback(async () => {
    if (scope !== "global" && !conversationId) return

    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const result = await capabilitiesApi.refresh(scope, conversationId)
      setData(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : "刷新失败"
      if (isWorkspaceNotice(message)) {
        setNotice(message)
      } else {
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }, [scope, conversationId])

  const showRefresh = scope === "global" || !!conversationId

  const filteredSkills = useMemo(() => {
    const items = data?.skills ?? []
    if (!searchQuery) return items
    const q = searchQuery.toLowerCase()
    return items.filter((s) => s.name.toLowerCase().includes(q))
  }, [data?.skills, searchQuery])

  const filteredMcps = useMemo(() => {
    const items = data?.mcps ?? []
    if (!searchQuery) return items
    const q = searchQuery.toLowerCase()
    return items.filter((m) => m.name.toLowerCase().includes(q))
  }, [data?.mcps, searchQuery])

  return (
    <div className="flex h-full flex-col min-h-0">
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
            disabled={loading || !showRefresh}
            size="xs"
            type="button"
            variant="secondary"
          >
            <AnimatedRefreshCwIcon data-icon="inline-start" spinning={loading} />
            刷新
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
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
              <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索..."
                className="h-8 w-[180px] pl-7 text-xs rounded-3xl"
              />
            </div>
          </div>

          <ScrollArea className="mt-4 min-h-0 flex-1">
            <TabsContents>
              <TabsContent value="skill">
                <SkillGrid
                  skills={filteredSkills}
                  loading={loading}
                  error={error}
                  notice={notice}
                  onRetry={fetchData}
                />
              </TabsContent>
              <TabsContent value="mcp">
                <McpGrid
                  mcps={filteredMcps}
                  loading={loading}
                  error={error}
                  notice={notice}
                  onRetry={fetchData}
                />
              </TabsContent>
            </TabsContents>
          </ScrollArea>
        </Tabs>
      </div>
    </div>
  )
}

function isWorkspaceNotice(message: string): boolean {
  return message.includes("no bound workspace") ||
    message.includes("workspace metadata is incomplete") ||
    message.includes("Workspace discovery requires conversationId")
}
