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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog"
import { capabilitiesApi } from "./api/capabilities"
import { workspaceSkillTrustApi } from "./api/workspace-skill-trust"
import { SkillGrid } from "./components/SkillGrid"
import { McpGrid } from "./components/McpGrid"
import { ScopeSelector } from "./components/ScopeSelector"
import { WorkspaceCapabilityCard } from "./components/WorkspaceCapabilityCard"
import {
  getMissingWorkspaceNotice,
  isWorkspaceNotice,
} from "./plugin-config-state"
import type {
  CapabilitiesResponse,
  CapabilityScope,
  SkillItem,
  WorkspaceCapabilityGroup,
  WorkspaceSkillTrustRecord,
} from "./types"

type WorkspaceCapabilityViewGroup = WorkspaceCapabilityGroup & {
  trustRecords: WorkspaceSkillTrustRecord[]
}

type PendingTrustDecision = {
  conversationId: string
  skillRef: string
  trusted: boolean
}

export function PluginConfigWorkspace() {
  const [activeTab, setActiveTab] = useState("skill")
  const [scope, setScope] = useState<CapabilityScope>("global")
  const [conversationId, setConversationId] = useState<string | undefined>()

  const [data, setData] = useState<CapabilitiesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [skillTrustRecords, setSkillTrustRecords] = useState<WorkspaceSkillTrustRecord[]>([])
  const [workspaceGroups, setWorkspaceGroups] = useState<WorkspaceCapabilityViewGroup[]>([])
  const [trustLoading, setTrustLoading] = useState(false)
  const [trustUpdatingSkillRef, setTrustUpdatingSkillRef] = useState<string | null>(null)
  const [trustUpdatingConversationId, setTrustUpdatingConversationId] = useState<string | null>(null)
  const [pendingTrustDecision, setPendingTrustDecision] = useState<PendingTrustDecision | null>(null)

  const queryTrustRecords = useCallback(async (
    targetConversationId: string | undefined,
    skills: SkillItem[],
  ): Promise<WorkspaceSkillTrustRecord[]> => {
    const workspaceSkillRefs = skills
      .filter((skill) => skill.level === "workspace")
      .map((skill) => skill.id)

    if (!targetConversationId || workspaceSkillRefs.length === 0) {
      return []
    }

    const trustResult = await workspaceSkillTrustApi.query(targetConversationId, workspaceSkillRefs)
    return trustResult.trusts
  }, [])

  const loadTrustRecords = useCallback(async (result: CapabilitiesResponse) => {
    setTrustLoading(true)
    try {
      const records = await queryTrustRecords(conversationId, result.skills)
      setSkillTrustRecords(records)
    } catch {
      setSkillTrustRecords([])
    } finally {
      setTrustLoading(false)
    }
  }, [conversationId, queryTrustRecords])

  const loadWorkspaceGroups = useCallback(async (refresh = false) => {
    const result = refresh
      ? await capabilitiesApi.refreshWorkspaceGroups(conversationId)
      : await capabilitiesApi.fetchWorkspaceGroups(conversationId)

    if (result.workspaces.length === 0) {
      setWorkspaceGroups([])
      setNotice(conversationId ? "该会话未绑定工作区。" : "暂无绑定工作区的会话。")
      return
    }

    const groups = await Promise.all(
      result.workspaces.map(async (group): Promise<WorkspaceCapabilityViewGroup> => {
        const trustRecords = await queryTrustRecords(group.conversationId, group.skills).catch(() => [])
        return {
          ...group,
          trustRecords,
        }
      })
    )

    setWorkspaceGroups(groups)
  }, [conversationId, queryTrustRecords])

  const fetchData = useCallback(async () => {
    const missingWorkspaceNotice = getMissingWorkspaceNotice(scope, conversationId)
    if (missingWorkspaceNotice) {
      setData(null)
      setNotice(missingWorkspaceNotice)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      if (scope === "workspace") {
        setData(null)
        setSkillTrustRecords([])
        await loadWorkspaceGroups(false)
      } else {
        setWorkspaceGroups([])
        const result = await capabilitiesApi.fetchGlobal()
        setData(result)
        await loadTrustRecords(result)
      }
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
  }, [scope, conversationId, loadTrustRecords, loadWorkspaceGroups])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchData() }, [fetchData])

  const handleScopeChange = useCallback(
    (newScope: CapabilityScope, newConversationId?: string) => {
      setScope(newScope)
      setConversationId(newConversationId)
      setData(null)
      setNotice(null)
      setSkillTrustRecords([])
      setWorkspaceGroups([])
      setTrustUpdatingConversationId(null)
      setTrustUpdatingSkillRef(null)
    },
    []
  )

  const handleRefresh = useCallback(async () => {
    const missingWorkspaceNotice = getMissingWorkspaceNotice(scope, conversationId)
    if (missingWorkspaceNotice) {
      setData(null)
      setNotice(missingWorkspaceNotice)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      if (scope === "workspace") {
        setData(null)
        setSkillTrustRecords([])
        await loadWorkspaceGroups(true)
      } else {
        setWorkspaceGroups([])
        const result = await capabilitiesApi.refreshGlobal()
        setData(result)
        await loadTrustRecords(result)
      }
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
  }, [scope, conversationId, loadTrustRecords, loadWorkspaceGroups])

  const handleTrustDecision = useCallback(async (
    targetConversationId: string | undefined,
    skillRef: string,
    trusted: boolean,
  ) => {
    if (!targetConversationId) {
      setNotice("请选择一个已绑定工作区的会话。")
      return
    }

    setPendingTrustDecision({
      conversationId: targetConversationId,
      skillRef,
      trusted,
    })
  }, [])

  const confirmTrustDecision = useCallback(async () => {
    if (!pendingTrustDecision) return

    const decision = pendingTrustDecision
    setPendingTrustDecision(null)
    setTrustUpdatingSkillRef(decision.skillRef)
    setTrustUpdatingConversationId(decision.conversationId)
    setError(null)
    try {
      const result = await workspaceSkillTrustApi.decide({
        conversationId: decision.conversationId,
        skillRef: decision.skillRef,
        trusted: decision.trusted,
        reason: decision.trusted ? "approved in plugin config" : "revoked in plugin config",
      })
      setSkillTrustRecords((current) => [
        ...current.filter((record) => record.skillRef !== decision.skillRef),
        result.record,
      ])
      setWorkspaceGroups((current) =>
        current.map((group) =>
          group.conversationId === decision.conversationId
            ? {
                ...group,
                trustRecords: [
                  ...group.trustRecords.filter((record) => record.skillRef !== decision.skillRef),
                  result.record,
                ],
              }
            : group
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新 Skill 信任状态失败")
    } finally {
      setTrustUpdatingSkillRef(null)
      setTrustUpdatingConversationId(null)
    }
  }, [pendingTrustDecision])

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

  const filteredWorkspaceSkillGroups = useMemo(() => {
    if (!searchQuery) return workspaceGroups
    const q = searchQuery.toLowerCase()
    return workspaceGroups.map((group) => ({
      ...group,
      skills: group.skills.filter((skill) => skill.name.toLowerCase().includes(q)),
    }))
  }, [workspaceGroups, searchQuery])

  const filteredWorkspaceMcpGroups = useMemo(() => {
    if (!searchQuery) return workspaceGroups
    const q = searchQuery.toLowerCase()
    return workspaceGroups.map((group) => ({
      ...group,
      mcps: group.mcps.filter((mcp) => mcp.name.toLowerCase().includes(q)),
    }))
  }, [workspaceGroups, searchQuery])

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
            disabled={loading}
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
                {scope === "workspace" ? (
                  <WorkspaceSkillGroups
                    groups={filteredWorkspaceSkillGroups}
                    loading={loading}
                    error={error}
                    notice={notice}
                    onRetry={fetchData}
                    trustLoading={trustLoading}
                    trustUpdatingConversationId={trustUpdatingConversationId}
                    trustUpdatingSkillRef={trustUpdatingSkillRef}
                    onTrustDecision={handleTrustDecision}
                  />
                ) : (
                  <SkillGrid
                    skills={filteredSkills}
                    loading={loading}
                    error={error}
                    notice={notice}
                    onRetry={fetchData}
                    trustRecords={skillTrustRecords}
                    trustLoading={trustLoading}
                    trustUpdatingSkillRef={trustUpdatingSkillRef}
                    onTrustDecision={(skillRef, trusted) =>
                      handleTrustDecision(conversationId, skillRef, trusted)
                    }
                  />
                )}
              </TabsContent>
              <TabsContent value="mcp">
                {scope === "workspace" ? (
                  <WorkspaceMcpGroups
                    groups={filteredWorkspaceMcpGroups}
                    loading={loading}
                    error={error}
                    notice={notice}
                    onRetry={fetchData}
                  />
                ) : (
                  <McpGrid
                    mcps={filteredMcps}
                    loading={loading}
                    error={error}
                    notice={notice}
                    onRetry={fetchData}
                  />
                )}
              </TabsContent>
            </TabsContents>
          </ScrollArea>
        </Tabs>
      </div>

      <Dialog
        open={!!pendingTrustDecision}
        onOpenChange={(open) => {
          if (!open) setPendingTrustDecision(null)
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {pendingTrustDecision?.trusted ? "信任工作区 Skill" : "撤销 Skill 信任"}
            </DialogTitle>
            <DialogDescription>
              {pendingTrustDecision?.trusted
                ? "信任后，内部智能体可在绑定工作区的 Run 中注入该 Skill 正文。"
                : "撤销后，该工作区 Skill 将不会再注入内部智能体 prompt。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingTrustDecision(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant={pendingTrustDecision?.trusted ? "secondary" : "destructive"}
              onClick={() => { void confirmTrustDecision() }}
            >
              {pendingTrustDecision?.trusted ? "确认信任" : "确认撤销"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

type WorkspaceGroupsBaseProps = {
  groups: WorkspaceCapabilityViewGroup[]
  loading: boolean
  error: string | null
  notice: string | null
  onRetry: () => void
}

type WorkspaceSkillGroupsProps = WorkspaceGroupsBaseProps & {
  trustLoading: boolean
  trustUpdatingConversationId: string | null
  trustUpdatingSkillRef: string | null
  onTrustDecision: (
    conversationId: string | undefined,
    skillRef: string,
    trusted: boolean,
  ) => void
}

function WorkspaceSkillGroups({
  groups,
  loading,
  error,
  notice,
  onRetry,
  trustLoading,
  trustUpdatingConversationId,
  trustUpdatingSkillRef,
  onTrustDecision,
}: WorkspaceSkillGroupsProps) {
  if (loading || error || notice || groups.length === 0) {
    return (
      <SkillGrid
        skills={[]}
        loading={loading}
        error={error}
        notice={notice ?? (groups.length === 0 ? "暂无绑定工作区的会话。" : null)}
        onRetry={onRetry}
      />
    )
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <WorkspaceCapabilityCard
          key={group.workspaceKey}
          title={group.title}
          subtitle={workspaceSubtitle(group)}
          skillCount={group.skills.length}
          mcpCount={group.mcps.length}
        >
          <SkillGrid
            skills={group.skills}
            loading={false}
            error={null}
            notice={null}
            onRetry={onRetry}
            trustRecords={group.trustRecords}
            trustLoading={trustLoading}
            trustUpdatingSkillRef={
              trustUpdatingConversationId === group.conversationId
                ? trustUpdatingSkillRef
                : null
            }
            onTrustDecision={(skillRef, trusted) =>
              onTrustDecision(group.conversationId, skillRef, trusted)
            }
          />
        </WorkspaceCapabilityCard>
      ))}
    </div>
  )
}

function WorkspaceMcpGroups({
  groups,
  loading,
  error,
  notice,
  onRetry,
}: WorkspaceGroupsBaseProps) {
  if (loading || error || notice || groups.length === 0) {
    return (
      <McpGrid
        mcps={[]}
        loading={loading}
        error={error}
        notice={notice ?? (groups.length === 0 ? "暂无绑定工作区的会话。" : null)}
        onRetry={onRetry}
      />
    )
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <WorkspaceCapabilityCard
          key={group.workspaceKey}
          title={group.title}
          subtitle={workspaceSubtitle(group)}
          skillCount={group.skills.length}
          mcpCount={group.mcps.length}
        >
          <McpGrid
            mcps={group.mcps}
            loading={false}
            error={null}
            notice={null}
            onRetry={onRetry}
          />
        </WorkspaceCapabilityCard>
      ))}
    </div>
  )
}

function workspaceSubtitle(group: WorkspaceCapabilityViewGroup): string {
  const suffix = group.conversationIds.length > 1
    ? ` · ${group.conversationIds.length} 个会话`
    : ""
  return `${group.rootPath}${suffix}`
}
