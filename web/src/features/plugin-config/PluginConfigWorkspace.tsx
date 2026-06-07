import { useCallback, useEffect, useState } from "react"
import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/animate/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { capabilitiesApi } from "./api/capabilities"
import { SkillGrid } from "./components/SkillGrid"
import { McpGrid } from "./components/McpGrid"
import { ScopeSelector } from "./components/ScopeSelector"
import type { CapabilitiesResponse, CapabilityScope, McpItem, SkillItem } from "./types"

export function PluginConfigWorkspace() {
  const [activeTab, setActiveTab] = useState("skill")
  const [scope, setScope] = useState<CapabilityScope>("global")
  const [conversationId, setConversationId] = useState<string | undefined>()

  const [data, setData] = useState<CapabilitiesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

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

  const skills: SkillItem[] = data?.skills ?? []
  const mcps: McpItem[] = data?.mcps ?? []
  const cacheHit = data?.cache?.hit
  const showRefresh = scope === "global" || !!conversationId

  return (
    <div className="flex h-full flex-col min-h-0">
      <header className="shrink-0 border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">插件配置</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          查看已发现的 Skill 和 MCP Server 配置
        </p>
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
                loading={loading}
                cacheHit={cacheHit}
                refreshable={showRefresh}
                onRefresh={handleRefresh}
              />
            </div>
          </div>

          <ScrollArea className="mt-4 min-h-0 flex-1">
            <TabsContents>
              <TabsContent value="skill">
                <SkillGrid
                  skills={skills}
                  loading={loading}
                  error={error}
                  notice={notice}
                  onRetry={fetchData}
                />
              </TabsContent>
              <TabsContent value="mcp">
                <McpGrid
                  mcps={mcps}
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
