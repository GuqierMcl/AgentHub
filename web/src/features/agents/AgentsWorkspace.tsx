import { useCallback, useEffect, useRef, useState } from "react"
import { PlusIcon, TrashIcon } from "lucide-react"
import { toast } from "sonner"

import { AgentAvatar } from "@/components/agent-avatar"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"

import { agentsApi } from "./api/agents"
import { AgentCard } from "./components/AgentCard"
import { AgentConfigurationForm } from "./components/AgentConfigurationForm"
import { AgentFormDialog } from "./components/AgentFormDialog"
import { AgentDetailsPanel } from "./components/AgentDetailsPanel"
import { InstructAgentCreateDialog } from "./components/InstructAgentCreateDialog"
import { ModelBindingDialog } from "./components/ModelBindingDialog"
import { useAgentOverride } from "./hooks/use-avatar-overrides"
import type { AgentDetail, AgentOrigin, AgentSummary } from "./types"

type OriginFilter = "all" | AgentOrigin

export function AgentsWorkspace() {
  const selectedAgentIdRef = useRef<string | null>(null)
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [enabledOnly, setEnabledOnly] = useState(false)
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all")
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<AgentDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [manualCreateOpen, setManualCreateOpen] = useState(false)
  const [modelBindingAgent, setModelBindingAgent] = useState<AgentSummary | null>(
    null
  )
  const [deleteTarget, setDeleteTarget] = useState<AgentDetail | null>(null)
  const [deleting, setDeleting] = useState(false)
  const selectedAgentOverride = useAgentOverride(selectedAgent?.id ?? "")

  const clearSelection = useCallback(() => {
    selectedAgentIdRef.current = null
    setSelectedAgentId(null)
    setSelectedAgent(null)
    setDetailLoading(false)
  }, [])

  const fetchAgents = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const data = await agentsApi.list({
        enabledOnly,
        origin: originFilter === "all" ? undefined : originFilter,
        tier: "primary",
      })
      setAgents(data.agents)

      const selectedId = selectedAgentIdRef.current
      if (selectedId && !data.agents.some((agent) => agent.id === selectedId)) {
        clearSelection()
      }
    } catch (error) {
      setListError(error instanceof Error ? error.message : "获取智能体列表失败")
    } finally {
      setListLoading(false)
    }
  }, [clearSelection, enabledOnly, originFilter])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchAgents()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [fetchAgents])

  const selectAgent = useCallback(async (agentId: string) => {
    selectedAgentIdRef.current = agentId
    setSelectedAgentId(agentId)
    setSelectedAgent(null)
    setDetailLoading(true)
    try {
      const detail = await agentsApi.get(agentId)
      if (selectedAgentIdRef.current === agentId) {
        setSelectedAgent(detail)
      }
    } catch (error) {
      if (selectedAgentIdRef.current === agentId) {
        toast.error(error instanceof Error ? error.message : "获取智能体详情失败")
        clearSelection()
      }
    } finally {
      if (selectedAgentIdRef.current === agentId) {
        setDetailLoading(false)
      }
    }
  }, [clearSelection])

  const handleToggleEnabled = useCallback(
    async (agentId: string, enabled: boolean) => {
      try {
        const updated = await agentsApi.update(agentId, { enabled })
        toast.success(enabled ? "智能体已启用" : "智能体已禁用")
        if (selectedAgentIdRef.current === agentId) {
          setSelectedAgent(updated)
        }
        await fetchAgents()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "操作失败")
      }
    },
    [fetchAgents]
  )

  const handleEdited = useCallback(
    async (agent: AgentDetail) => {
      setSelectedAgent(agent)
      toast.success("智能体已更新")
      await fetchAgents()
    },
    [fetchAgents]
  )

  const handleCreated = useCallback(
    async (agent: AgentDetail) => {
      setManualCreateOpen(false)
      toast.success("智能体已创建")
      await fetchAgents()
      await selectAgent(agent.id)
    },
    [fetchAgents, selectAgent]
  )

  const handleModelBound = useCallback(async () => {
    setModelBindingAgent(null)
    toast.success("模型配置已更新")
    await fetchAgents()
    const selectedId = selectedAgentIdRef.current
    if (selectedId) {
      await selectAgent(selectedId)
    }
  }, [fetchAgents, selectAgent])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) {
      return
    }

    setDeleting(true)
    try {
      await agentsApi.delete(deleteTarget.id)
      toast.success("智能体已删除")
      setDeleteTarget(null)
      clearSelection()
      await fetchAgents()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败")
    } finally {
      setDeleting(false)
    }
  }, [clearSelection, deleteTarget, fetchAgents])

  const canConfigureModel =
    selectedAgent &&
    selectedAgent.origin !== "external" &&
    selectedAgent.enabled
  const canDelete =
    selectedAgent?.origin === "user" && selectedAgent.readonly === false
  const canEdit = canDelete

  return (
      <>
          <section className="grid h-full min-h-0 min-w-0 grid-cols-[21rem_minmax(0,1fr)] bg-background">
              <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-border border-r bg-sidebar/45">
                  <div className="flex flex-col gap-4 border-border border-b p-4">
                      <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                              <h1 className="text-base font-semibold">
                                  智能体
                              </h1>
                              <p className="text-muted-foreground text-xs">
                                  管理执行身份与能力
                              </p>
                          </div>
                          <Button
                              onClick={() => setCreateDialogOpen(true)}
                              size="sm"
                              type="button"
                          >
                              <PlusIcon data-icon="inline-start" />
                              新增
                          </Button>
                      </div>
                      <div className="flex gap-2">
                          <Select
                              onValueChange={(value) =>
                                  setEnabledOnly(value === "enabled")
                              }
                              value={enabledOnly ? "enabled" : "all"}
                          >
                              <SelectTrigger
                                  className="min-w-0 flex-1"
                                  size="sm"
                              >
                                  <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                  <SelectGroup>
                                      <SelectItem value="all">
                                          全部状态
                                      </SelectItem>
                                      <SelectItem value="enabled">
                                          仅启用
                                      </SelectItem>
                                  </SelectGroup>
                              </SelectContent>
                          </Select>
                          <Select
                              onValueChange={(value) =>
                                  setOriginFilter(value as OriginFilter)
                              }
                              value={originFilter}
                          >
                              <SelectTrigger
                                  className="min-w-0 flex-1"
                                  size="sm"
                              >
                                  <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                  <SelectGroup>
                                      <SelectItem value="all">
                                          全部来源
                                      </SelectItem>
                                      <SelectItem value="system">
                                          系统
                                      </SelectItem>
                                      <SelectItem value="user">用户</SelectItem>
                                      <SelectItem value="external">
                                          外部
                                      </SelectItem>
                                  </SelectGroup>
                              </SelectContent>
                          </Select>
                      </div>
                  </div>
                  <ScrollArea
                      className="min-h-0 min-w-0 flex-1"
                      viewportClassName="overflow-x-hidden [&>div]:block! [&>div]:min-w-0 [&>div]:w-full [&>div]:max-w-full"
                  >
                      {listLoading ? (
                          <div className="flex justify-center p-8">
                              <Spinner />
                          </div>
                      ) : listError ? (
                          <Empty className="border-0 p-6">
                              <EmptyHeader>
                                  <EmptyTitle>列表加载失败</EmptyTitle>
                                  <EmptyDescription>
                                      {listError}
                                  </EmptyDescription>
                              </EmptyHeader>
                              <Button
                                  onClick={() => void fetchAgents()}
                                  size="sm"
                                  variant="outline"
                              >
                                  重试
                              </Button>
                          </Empty>
                      ) : agents.length === 0 ? (
                          <Empty className="border-0 p-6">
                              <EmptyHeader>
                                  <EmptyTitle>暂无智能体</EmptyTitle>
                                  <EmptyDescription>
                                      创建自定义智能体开始配置。
                                  </EmptyDescription>
                              </EmptyHeader>
                          </Empty>
                      ) : (
                          <div className="flex w-full min-w-0 flex-col gap-1 p-2">
                              {agents.map((agent) => (
                                  <AgentCard
                                      agent={agent}
                                      key={agent.id}
                                      onClick={() => void selectAgent(agent.id)}
                                      onToggleEnabled={handleToggleEnabled}
                                      selected={selectedAgentId === agent.id}
                                  />
                              ))}
                          </div>
                      )}
                  </ScrollArea>
              </aside>

              <section className="flex min-h-0 min-w-0 flex-col">
                  {selectedAgent ? (
                      <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-border border-b px-6">
                          <div className="flex min-w-0 items-center gap-3">
                              <AgentAvatar agent={selectedAgent} override={selectedAgentOverride} />
                              <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">
                                      {selectedAgent.name}
                                  </p>
                                  <p className="truncate text-muted-foreground text-xs">
                                      {canEdit
                                          ? "编辑自定义智能体配置"
                                          : "查看智能体详情"}
                                  </p>
                              </div>
                          </div>
                          <div className="flex items-center gap-2">
                              {canDelete ? (
                                  <Button
                                      onClick={() =>
                                          setDeleteTarget(selectedAgent)
                                      }
                                      size="sm"
                                      type="button"
                                      variant="destructive"
                                  >
                                      <TrashIcon data-icon="inline-start" />
                                      删除
                                  </Button>
                              ) : null}
                          </div>
                      </header>
                  ) : null}

                  {selectedAgent && canEdit ? (
                      <ScrollArea className="min-h-0 flex-1">
                          <div className="mx-auto w-full max-w-3xl p-7">
                              <AgentConfigurationForm
                                  active
                                  agent={selectedAgent}
                                  canConfigureModel={Boolean(canConfigureModel)}
                                  key={selectedAgent.id}
                                  mode="edit"
                                  onConfigureModel={() =>
                                      setModelBindingAgent(selectedAgent)
                                  }
                                  onSaved={handleEdited}
                              />
                          </div>
                      </ScrollArea>
                  ) : null}

                  {!selectedAgent || !canEdit ? (
                      <AgentDetailsPanel
                          agent={selectedAgent}
                          canConfigureModel={Boolean(canConfigureModel)}
                          loading={detailLoading}
                          onConfigureModel={() => {
                              if (selectedAgent) {
                                  setModelBindingAgent(selectedAgent);
                              }
                          }}
                      />
                  ) : null}
              </section>
          </section>

          <InstructAgentCreateDialog
              onOpenManualCreate={async () => {
                  setCreateDialogOpen(false)
                  setManualCreateOpen(true)
              }}
              onOpenAgent={async (agentId) => {
                  await selectAgent(agentId);
              }}
              onOpenChange={setCreateDialogOpen}
              onRefreshAgents={fetchAgents}
              open={createDialogOpen}
          />

          <AgentFormDialog
              onOpenChange={setManualCreateOpen}
              onSaved={handleCreated}
              open={manualCreateOpen}
          />

          <ModelBindingDialog
              agent={modelBindingAgent}
              onBound={() => void handleModelBound()}
              onOpenChange={(open) => {
                  if (!open) {
                      setModelBindingAgent(null);
                  }
              }}
              open={Boolean(modelBindingAgent)}
          />

          <AlertDialog
              onOpenChange={(open) => {
                  if (!open && !deleting) {
                      setDeleteTarget(null);
                  }
              }}
              open={Boolean(deleteTarget)}
          >
              <AlertDialogContent>
                  <AlertDialogHeader>
                      <AlertDialogTitle>确认删除</AlertDialogTitle>
                      <AlertDialogDescription>
                          确定要删除智能体 "{deleteTarget?.name}"
                          吗？此操作不可撤销。
                      </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                      <AlertDialogCancel disabled={deleting}>
                          取消
                      </AlertDialogCancel>
                      <AlertDialogAction
                          disabled={deleting}
                          onClick={() => void handleDeleteConfirm()}
                      >
                          {deleting ? "删除中..." : "删除"}
                      </AlertDialogAction>
                  </AlertDialogFooter>
              </AlertDialogContent>
          </AlertDialog>
      </>
  );
}
