import { useState, useEffect, useCallback, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { SearchIcon, XIcon, ChevronRightIcon, FolderOpenIcon, AlertTriangleIcon } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/animate-ui/components/radix/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { AgentAvatar } from "@/components/agent-avatar"
import { agentsApi } from "@/features/agents/api/agents"
import { useAvatarOverrides } from "@/features/agents/hooks/use-avatar-overrides"
import { workbenchQueryKeys } from "../api/query-keys"
import type { ConversationDetail, ConversationListItem, CreateConversationBody } from "../types"
import type { AgentSummary } from "@/features/agents/types"
import { WorkspacePickerDialog } from "./WorkspacePickerDialog"

const EMPTY_AGENTS: AgentSummary[] = []

type NewConversationDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (conversationId: string) => void
  onCreateConversation: (body: CreateConversationBody) => Promise<ConversationDetail>
  existingConversations: ConversationListItem[]
  onSwitchConversation: (conversationId: string) => void
}

export function NewConversationDialog({
  open,
  onOpenChange,
  onCreated,
  onCreateConversation,
  existingConversations,
  onSwitchConversation,
}: NewConversationDialogProps) {
  const [search, setSearch] = useState("")
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [existingOpen, setExistingOpen] = useState(true)
  const [agentsOpen, setAgentsOpen] = useState(true)
  const [workspacePath, setWorkspacePath] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)

  const agentsQuery = useQuery({
    queryKey: workbenchQueryKeys.agents.primaryEnabled,
    queryFn: () => agentsApi.list({ tier: "primary", enabledOnly: true }),
    enabled: open,
  })

  const agents = agentsQuery.data?.agents ?? EMPTY_AGENTS
  const { data: avatarManifest } = useAvatarOverrides()
  const avatarOverrides = avatarManifest?.agents ?? {}

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      setSearch("")
      setSelectedAgentIds([])
      setWorkspacePath("")
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open])

  const filteredConversations = useMemo(() => {
    if (!search) return existingConversations
    const q = search.toLowerCase()
    return existingConversations.filter((c) => c.title.toLowerCase().includes(q))
  }, [existingConversations, search])

  const filteredAgents = useMemo(() => {
    if (!search) return agents
    const q = search.toLowerCase()
    return agents.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
  }, [agents, search])

  const selectedAgents = useMemo(
    () => agents.filter((a) => selectedAgentIds.includes(a.id)),
    [agents, selectedAgentIds]
  )

  const toggleAgent = useCallback((id: string) => {
    setSelectedAgentIds((prev) => {
      if (id === "orchestrator") {
        if (prev.includes("orchestrator")) {
          const nonOrch = prev.filter((a) => a !== "orchestrator")
          if (nonOrch.length >= 2) {
            toast.warning("群聊内必须包含orchestrator")
            return prev
          }
          return nonOrch
        }
        return [...prev, "orchestrator"]
      }

      const isSelecting = !prev.includes(id)

      if (isSelecting) {
        const next = [...prev, id]
        if (next.filter((a) => a !== "orchestrator").length >= 2 && !next.includes("orchestrator")) {
          next.push("orchestrator")
        }
        return next
      } else {
        return prev.filter((a) => a !== id)
      }
    })
  }, [])

  const handleSelectWorkspace = useCallback(() => {
    setPickerOpen(true)
  }, [])

  const handleCreate = useCallback(async () => {
    if (selectedAgentIds.length === 0) {
      toast.warning("请至少选择一个智能体")
      return
    }
    if (selectedAgentIds.length === 1 && selectedAgentIds[0] === "orchestrator") {
      toast.warning("不能仅选择 Orchestrator，请至少搭配一个其他智能体");
      return
    }
    setSaving(true)
    try {
      const mode = selectedAgentIds.length === 1 ? "single" : "group"
      const title = mode === "single"
        ? agents.find((a) => a.id === selectedAgentIds[0])?.name ?? "新会话"
        : `群聊 (${selectedAgentIds.length}人)`

      const agentList = selectedAgentIds.map((id) => ({
        agentId: id,
      }))

      const body: CreateConversationBody = {
        title,
        mode,
        agents: agentList,
        metadata: workspacePath.trim()
          ? {
              workspace: {
                workspaceId: `workspace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                backendType: "local",
                rootPath: workspacePath.trim(),
              },
            }
          : undefined,
      }

      const result = await onCreateConversation(body)
      toast.success("会话已创建")
      onCreated(result.id)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建失败")
    } finally {
      setSaving(false)
    }
  }, [selectedAgentIds, agents, workspacePath, onCreateConversation, onCreated, onOpenChange])

  const handleSwitch = useCallback((id: string) => {
    onSwitchConversation(id)
    onOpenChange(false)
  }, [onSwitchConversation, onOpenChange])

  return (
    <><Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent from="top" className="w-[700px] p-0 flex flex-col max-h-[80vh]">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>新建会话</DialogTitle>
          <DialogDescription>选择已有会话或创建新会话</DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-3">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索会话或智能体"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="px-6 pb-3">
          <button
            type="button"
            onClick={handleSelectWorkspace}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm transition-colors",
              workspacePath
                ? "border border-border bg-muted/40 text-foreground hover:bg-accent"
                :               "border border-amber-400/60 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-600/60 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/50"
            )}
          >
            {workspacePath ? (
              <>
                <FolderOpenIcon className="size-4 shrink-0" />
                <span className="flex-1 min-w-0 truncate text-left">{workspacePath}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); setWorkspacePath("") }}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="size-3.5" />
                </span>
              </>
            ) : (
              <>
                <AlertTriangleIcon className="size-4 shrink-0" />
                <span className="flex-1 text-left">未选择工作空间</span>
              </>
            )}
          </button>
          {!workspacePath && (
            <p className="mt-1.5 px-1 text-[11px] text-amber-600/80 dark:text-amber-400/70">
              未关联工作区时，智能体将无法访问本地文件、执行 Shell 命令及操作项目资源。
            </p>
          )}
        </div>

        <div className="flex flex-1 min-h-0 px-6 gap-4 pb-2 overflow-hidden">
          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-2 pr-3">
              <Collapsible open={existingOpen} onOpenChange={setExistingOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium cursor-pointer hover:text-foreground/80">
                  <ChevronRightIcon className={`size-4 transition-transform ${existingOpen ? "rotate-90" : ""}`} />
                  选择已有会话
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1">
                  <div className="space-y-0.5">
                    {filteredConversations.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">无匹配会话</p>
                    ) : (
                      filteredConversations.map((conv) => (
                        <button
                          key={conv.id}
                          type="button"
                          onClick={() => handleSwitch(conv.id)}
                          className="w-full text-left text-xs py-1.5 px-2 rounded-md hover:bg-accent transition-colors truncate"
                        >
                          {conv.title}
                        </button>
                      ))
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible open={agentsOpen} onOpenChange={setAgentsOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium cursor-pointer hover:text-foreground/80">
                  <ChevronRightIcon className={`size-4 transition-transform ${agentsOpen ? "rotate-90" : ""}`} />
                  智能体
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1">
                  <div className="space-y-0.5">
                    {filteredAgents.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">无智能体</p>
                    ) : (
                      filteredAgents.map((agent) => (
                        <label
                          key={agent.id}
                          className="flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer hover:bg-accent"
                        >
                          <Checkbox
                            checked={selectedAgentIds.includes(agent.id)}
                            onCheckedChange={() => toggleAgent(agent.id)}
                            size="sm"
                          />
                           <AgentAvatar agent={agent} override={avatarOverrides[agent.id]} size="sm" />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium truncate">{agent.name}</div>
                            <div className="text-[10px] text-muted-foreground truncate">{agent.description}</div>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </ScrollArea>

          <ScrollArea className="w-[160px] shrink-0 min-w-0">
            {selectedAgents.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  已选择 {selectedAgents.length} 个智能体
                </p>
                <div className="space-y-1">
                  {selectedAgents.map((agent) => (
                    <div key={agent.id} className="flex items-center justify-between gap-1 rounded-md bg-muted px-2 py-1">
                      <span className="text-xs truncate">{agent.name}</span>
                      <button
                        type="button"
                        onClick={() => toggleAgent(agent.id)}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        <XIcon className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <Badge variant="secondary" className="text-[10px]">
                  {selectedAgentIds.length === 1 ? "单聊" : "群聊"}
                </Badge>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">选择智能体开始会话</p>
            )}
          </ScrollArea>
        </div>

        <DialogFooter className="px-6 pb-6 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleCreate} disabled={saving || selectedAgentIds.length === 0}>
            {saving ? "创建中..." : "完成"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      <WorkspacePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(path) => setWorkspacePath(path)}
      />
    </>
  )
}
