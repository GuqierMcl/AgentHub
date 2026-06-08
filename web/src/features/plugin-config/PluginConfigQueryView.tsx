import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { ScrollArea } from "@/components/ui/scroll-area"
import {
  TabsContent,
  TabsContents,
} from "@/components/animate-ui/components/animate/tabs"

import { capabilitiesApi } from "./api/capabilities"
import { mcpTrustApi } from "./api/mcp-trust"
import { workspaceSkillTrustApi } from "./api/workspace-skill-trust"
import { McpGrid } from "./components/McpGrid"
import { SkillGrid } from "./components/SkillGrid"
import { WorkspaceCapabilityCard } from "./components/WorkspaceCapabilityCard"
import {
  getMissingWorkspaceNotice,
  isWorkspaceNotice,
} from "./plugin-config-state"
import type {
  CapabilitiesResponse,
  CapabilityScope,
  McpItem,
  McpTrustRecord,
  SkillItem,
  WorkspaceCapabilityGroup,
  WorkspaceSkillTrustRecord,
} from "./types"

type WorkspaceCapabilityViewGroup = WorkspaceCapabilityGroup & {
  trustRecords: WorkspaceSkillTrustRecord[]
  mcpTrustRecords: McpTrustRecord[]
}

type PluginConfigQueryViewProps = {
  conversationId?: string
  onLoadingChange: (loading: boolean) => void
  refreshToken: number
  scope: CapabilityScope
  searchQuery: string
}

export function PluginConfigQueryView({
  conversationId,
  onLoadingChange,
  refreshToken,
  scope,
  searchQuery,
}: PluginConfigQueryViewProps) {
  const [data, setData] = useState<CapabilitiesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [skillTrustRecords, setSkillTrustRecords] = useState<WorkspaceSkillTrustRecord[]>([])
  const [workspaceGroups, setWorkspaceGroups] = useState<WorkspaceCapabilityViewGroup[]>([])
  const [trustLoading, setTrustLoading] = useState(false)
  const [trustUpdatingSkillRef, setTrustUpdatingSkillRef] = useState<string | null>(null)
  const [trustUpdatingMcpRef, setTrustUpdatingMcpRef] = useState<string | null>(null)
  const [trustUpdatingConversationId, setTrustUpdatingConversationId] = useState<string | null>(null)
  const autoLoadStartedRef = useRef(false)
  const lastRefreshTokenRef = useRef(refreshToken)
  const requestIdRef = useRef(0)

  useEffect(() => {
    onLoadingChange(loading)
  }, [loading, onLoadingChange])

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

    const trustResult = await workspaceSkillTrustApi.query(
      targetConversationId,
      workspaceSkillRefs,
    )
    return trustResult.trusts
  }, [])

  const queryMcpTrustRecords = useCallback(async (
    targetConversationId: string | undefined,
    mcps: McpItem[],
  ): Promise<McpTrustRecord[]> => {
    const workspaceMcpRefs = mcps
      .filter((mcp) => mcp.level === "workspace")
      .map((mcp) => mcp.id)

    if (!targetConversationId || workspaceMcpRefs.length === 0) {
      return []
    }

    const trustResult = await mcpTrustApi.query(
      targetConversationId,
      workspaceMcpRefs,
    )
    return trustResult.trusts
  }, [])

  const fetchTrustRecords = useCallback(async (
    targetConversationId: string | undefined,
    skills: SkillItem[],
  ): Promise<WorkspaceSkillTrustRecord[]> => {
    setTrustLoading(true)
    try {
      return await queryTrustRecords(targetConversationId, skills)
    } catch {
      return []
    } finally {
      setTrustLoading(false)
    }
  }, [queryTrustRecords])

  const fetchWorkspaceGroups = useCallback(async (
    targetConversationId: string | undefined,
    refresh = false,
  ): Promise<{
    groups: WorkspaceCapabilityViewGroup[]
    notice: string | null
  }> => {
    const result = refresh
      ? await capabilitiesApi.refreshWorkspaceGroups(targetConversationId)
      : await capabilitiesApi.fetchWorkspaceGroups(targetConversationId)

    if (result.workspaces.length === 0) {
      return {
        groups: [],
        notice: targetConversationId
          ? "该会话未绑定工作区。"
          : "暂无绑定工作区的会话。",
      }
    }

    const groups = await Promise.all(
      result.workspaces.map(async (group): Promise<WorkspaceCapabilityViewGroup> => {
        const [trustRecords, mcpTrustRecords] = await Promise.all([
          queryTrustRecords(group.conversationId, group.skills).catch(() => []),
          queryMcpTrustRecords(group.conversationId, group.mcps).catch(() => []),
        ])

        return {
          ...group,
          trustRecords,
          mcpTrustRecords,
        }
      }),
    )

    return {
      groups,
      notice: null,
    }
  }, [queryMcpTrustRecords, queryTrustRecords])

  const fetchData = useCallback(async (refresh = false) => {
    const currentRequestId = ++requestIdRef.current
    const missingWorkspaceNotice = getMissingWorkspaceNotice(scope, conversationId)

    if (missingWorkspaceNotice) {
      setData(null)
      setSkillTrustRecords([])
      setWorkspaceGroups([])
      setError(null)
      setNotice(missingWorkspaceNotice)
      return
    }

    setLoading(true)
    setError(null)
    setNotice(null)

    try {
      if (scope === "workspace") {
        const result = await fetchWorkspaceGroups(conversationId, refresh)
        if (requestIdRef.current !== currentRequestId) {
          return
        }
        setData(null)
        setSkillTrustRecords([])
        setWorkspaceGroups(result.groups)
        setNotice(result.notice)
        return
      }

      const result = refresh
        ? await capabilitiesApi.refreshGlobal()
        : await capabilitiesApi.fetchGlobal()
      const trustRecords = await fetchTrustRecords(conversationId, result.skills)
      if (requestIdRef.current !== currentRequestId) {
        return
      }
      setData(result)
      setSkillTrustRecords(trustRecords)
      setWorkspaceGroups([])
    } catch (err) {
      if (requestIdRef.current !== currentRequestId) {
        return
      }

      const message = err instanceof Error
        ? err.message
        : refresh ? "刷新失败" : "加载失败"
      if (isWorkspaceNotice(message)) {
        setNotice(message)
      } else {
        setError(message)
      }
    } finally {
      if (requestIdRef.current === currentRequestId) {
        setLoading(false)
      }
    }
  }, [conversationId, fetchTrustRecords, fetchWorkspaceGroups, scope])

  useEffect(() => {
    if (autoLoadStartedRef.current) {
      return
    }
    autoLoadStartedRef.current = true
    void fetchData(false)
  }, [fetchData])

  useEffect(() => {
    if (refreshToken === 0 || refreshToken === lastRefreshTokenRef.current) {
      return
    }
    lastRefreshTokenRef.current = refreshToken
    void fetchData(true)
  }, [fetchData, refreshToken])

  const handleRetry = useCallback(() => {
    void fetchData(true)
  }, [fetchData])

  const handleTrustDecision = useCallback(async (
    targetConversationId: string | undefined,
    kind: "skill" | "mcp",
    ref: string,
    trusted: boolean,
  ) => {
    if (!targetConversationId) {
      setNotice("请选择一个已绑定工作区的会话。")
      return
    }

    if (kind === "skill") setTrustUpdatingSkillRef(ref)
    else setTrustUpdatingMcpRef(ref)
    setTrustUpdatingConversationId(targetConversationId)
    setError(null)

    try {
      if (kind === "skill") {
        const result = await workspaceSkillTrustApi.decide({
          conversationId: targetConversationId,
          skillRef: ref,
          trusted,
          reason: trusted ? "approved in plugin config" : "revoked in plugin config",
        })
        setSkillTrustRecords((current) => [
          ...current.filter((record) => record.skillRef !== ref),
          result.record,
        ])
        setWorkspaceGroups((current) =>
          current.map((group) =>
            group.conversationId === targetConversationId
              ? {
                  ...group,
                  trustRecords: [
                    ...group.trustRecords.filter((record) => record.skillRef !== ref),
                    result.record,
                  ],
                }
              : group,
          ),
        )
      } else {
        const result = await mcpTrustApi.decide({
          conversationId: targetConversationId,
          mcpRef: ref,
          trusted,
          reason: trusted ? "approved in plugin config" : "revoked in plugin config",
        })
        setWorkspaceGroups((current) =>
          current.map((group) =>
            group.conversationId === targetConversationId
              ? {
                  ...group,
                  mcpTrustRecords: [
                    ...group.mcpTrustRecords.filter((record) => record.mcpRef !== ref),
                    result.record,
                  ],
                }
              : group,
          ),
        )
      }

      toast.success(
        trusted
          ? `已信任该 ${kind === "skill" ? "Skill" : "MCP"}`
          : `已撤销该 ${kind === "skill" ? "Skill" : "MCP"} 信任`,
      )
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : kind === "skill"
          ? "更新 Skill 信任状态失败"
          : "更新 MCP 信任状态失败"
      setError(message)
      toast.error(message)
    } finally {
      setTrustUpdatingSkillRef(null)
      setTrustUpdatingMcpRef(null)
      setTrustUpdatingConversationId(null)
    }
  }, [])

  const filteredSkills = useMemo(() => {
    const items = data?.skills ?? []
    if (!searchQuery) return items
    const q = searchQuery.toLowerCase()
    return items.filter((skill) => skill.name.toLowerCase().includes(q))
  }, [data?.skills, searchQuery])

  const filteredMcps = useMemo(() => {
    const items = data?.mcps ?? []
    if (!searchQuery) return items
    const q = searchQuery.toLowerCase()
    return items.filter((mcp) => mcp.name.toLowerCase().includes(q))
  }, [data?.mcps, searchQuery])

  const filteredWorkspaceSkillGroups = useMemo(() => {
    if (!searchQuery) return workspaceGroups
    const q = searchQuery.toLowerCase()
    return workspaceGroups.map((group) => ({
      ...group,
      skills: group.skills.filter((skill) => skill.name.toLowerCase().includes(q)),
    }))
  }, [searchQuery, workspaceGroups])

  const filteredWorkspaceMcpGroups = useMemo(() => {
    if (!searchQuery) return workspaceGroups
    const q = searchQuery.toLowerCase()
    return workspaceGroups.map((group) => ({
      ...group,
      mcps: group.mcps.filter((mcp) => mcp.name.toLowerCase().includes(q)),
    }))
  }, [searchQuery, workspaceGroups])

  const showGlobalLoadingState = loading && data === null
  const showWorkspaceLoadingState =
    loading && workspaceGroups.length === 0 && notice === null && error === null

  return (
    <ScrollArea className="min-h-0 flex-1">
      <TabsContents className="h-full">
        <TabsContent value="skill">
          {scope === "workspace" ? (
            <WorkspaceSkillGroups
              groups={filteredWorkspaceSkillGroups}
              loading={showWorkspaceLoadingState}
              error={error}
              notice={notice}
              onRetry={handleRetry}
              trustLoading={trustLoading}
              trustUpdatingConversationId={trustUpdatingConversationId}
              trustUpdatingSkillRef={trustUpdatingSkillRef}
              onTrustDecision={(targetConversationId, skillRef, trusted) =>
                handleTrustDecision(targetConversationId, "skill", skillRef, trusted)
              }
            />
          ) : (
            <SkillGrid
              skills={filteredSkills}
              loading={showGlobalLoadingState}
              error={error}
              notice={notice}
              onRetry={handleRetry}
              trustRecords={skillTrustRecords}
              trustLoading={trustLoading}
              trustUpdatingSkillRef={trustUpdatingSkillRef}
              onTrustDecision={(skillRef, trusted) =>
                handleTrustDecision(conversationId, "skill", skillRef, trusted)
              }
            />
          )}
        </TabsContent>
        <TabsContent value="mcp">
          {scope === "workspace" ? (
            <WorkspaceMcpGroups
              groups={filteredWorkspaceMcpGroups}
              loading={showWorkspaceLoadingState}
              error={error}
              notice={notice}
              onRetry={handleRetry}
              trustLoading={trustLoading}
              trustUpdatingConversationId={trustUpdatingConversationId}
              trustUpdatingMcpRef={trustUpdatingMcpRef}
              onTrustDecision={(targetConversationId, mcpRef, trusted) =>
                handleTrustDecision(targetConversationId, "mcp", mcpRef, trusted)
              }
            />
          ) : (
            <McpGrid
              mcps={filteredMcps}
              loading={showGlobalLoadingState}
              error={error}
              notice={notice}
              onRetry={handleRetry}
            />
          )}
        </TabsContent>
      </TabsContents>
    </ScrollArea>
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

type WorkspaceMcpGroupsProps = WorkspaceGroupsBaseProps & {
  trustLoading: boolean
  trustUpdatingConversationId: string | null
  trustUpdatingMcpRef: string | null
  onTrustDecision: (
    conversationId: string | undefined,
    mcpRef: string,
    trusted: boolean,
  ) => void
}

function WorkspaceMcpGroups({
  groups,
  loading,
  error,
  notice,
  onRetry,
  trustLoading,
  trustUpdatingConversationId,
  trustUpdatingMcpRef,
  onTrustDecision,
}: WorkspaceMcpGroupsProps) {
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
            trustRecords={group.mcpTrustRecords}
            trustLoading={trustLoading}
            trustUpdatingMcpRef={
              trustUpdatingConversationId === group.conversationId
                ? trustUpdatingMcpRef
                : null
            }
            onTrustDecision={(mcpRef, trusted) =>
              onTrustDecision(group.conversationId, mcpRef, trusted)
            }
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
