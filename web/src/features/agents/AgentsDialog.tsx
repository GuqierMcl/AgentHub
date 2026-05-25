import { useState, useEffect, useCallback } from "react"
import { PlusIcon, Loader2Icon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { agentsApi } from "./api/agents"
import { useToast } from "../settings/components/toast"
import type { AgentSummary, AgentDetail } from "./types"
import { AgentCard } from "./components/AgentCard"
import { AgentFormDialog } from "./components/AgentFormDialog"
import { AgentDeleteDialog } from "./components/AgentDeleteDialog"

type AgentsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AgentsDialog({ open, onOpenChange }: AgentsDialogProps) {
  const { addToast } = useToast()
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filter state
  const [filterEnabledOnly, setFilterEnabledOnly] = useState(true)
  const [filterOrigin, setFilterOrigin] = useState<"all" | "system" | "user" | "external">("all")

  // Form dialog state
  const [formOpen, setFormOpen] = useState(false)
  const [editAgent, setEditAgent] = useState<AgentDetail | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AgentSummary | null>(null)

  const fetchAgents = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await agentsApi.list({
        enabledOnly: filterEnabledOnly,
        tier: "primary",
        origin: filterOrigin !== "all" ? filterOrigin : undefined,
      })
      setAgents(data.agents)
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取智能体列表失败")
    } finally {
      setLoading(false)
    }
  }, [filterEnabledOnly, filterOrigin])

  useEffect(() => {
    if (open) {
      fetchAgents()
    }
  }, [open, filterEnabledOnly, filterOrigin, fetchAgents])

  const handleCreate = useCallback(() => {
    setEditAgent(null)
    setFormOpen(true)
  }, [])

  const handleCardClick = useCallback((agent: AgentSummary) => {
    setEditAgent(null)
    setEditingId(agent.id)
    setFormOpen(true)
    agentsApi.get(agent.id).then((detail) => {
      setEditAgent(detail)
    }).catch((err) => {
      addToast(err instanceof Error ? err.message : "获取智能体详情失败", "error")
      setFormOpen(false)
    }).finally(() => {
      setEditingId(null)
    })
  }, [addToast])

  const handleDeleteClick = useCallback((agent: AgentSummary) => {
    setDeleteTarget(agent)
    setDeleteOpen(true)
  }, [])

  const handleFormSaved = useCallback(() => {
    setFormOpen(false)
    addToast(editAgent ? "智能体已更新" : "智能体已创建", "success")
    fetchAgents()
  }, [editAgent, addToast, fetchAgents])

  const handleDeleted = useCallback(() => {
    setDeleteOpen(false)
    addToast("智能体已删除", "success")
    fetchAgents()
  }, [addToast, fetchAgents])

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent from="top" className="w-[720px] h-[600px] p-0 flex flex-col">
          <div className="flex items-center justify-between px-6 pt-6 pb-2 pr-14">
            <div>
              <DialogTitle>智能体管理</DialogTitle>
              <DialogDescription className="sr-only">
                查看、创建、编辑和删除智能体
              </DialogDescription>
            </div>
            <Button size="sm" onClick={handleCreate}>
              <PlusIcon className="size-4 mr-1" />
              新增
            </Button>
          </div>

          <div className="flex items-center gap-2 px-6 pb-3">
            <Select
              value={filterEnabledOnly ? "enabled" : "all"}
              onValueChange={(v) => setFilterEnabledOnly(v === "enabled")}
            >
              <SelectTrigger className="h-8 text-xs w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">仅启用的</SelectItem>
                <SelectItem value="all">全部</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filterOrigin}
              onValueChange={(v) => setFilterOrigin(v as typeof filterOrigin)}
            >
              <SelectTrigger className="h-8 text-xs w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部来源</SelectItem>
                <SelectItem value="system">系统</SelectItem>
                <SelectItem value="user">用户</SelectItem>
                <SelectItem value="external">外部</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="px-6 pb-6">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <p className="text-sm text-destructive">{error}</p>
                  <Button variant="outline" size="sm" onClick={fetchAgents}>
                    重试
                  </Button>
                </div>
              ) : agents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <p className="text-sm text-muted-foreground">暂无智能体</p>
                  <Button variant="outline" size="sm" onClick={handleCreate}>
                    创建第一个智能体
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {agents.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      onClick={() => handleCardClick(agent)}
                      onDelete={() => handleDeleteClick(agent)}
                    />
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AgentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        agent={editAgent}
        editingId={editingId}
        onSaved={handleFormSaved}
      />

      <AgentDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        agent={deleteTarget}
        onDeleted={handleDeleted}
      />
    </>
  )
}
