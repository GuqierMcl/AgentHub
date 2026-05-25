import { useState, useEffect, useCallback } from "react"
import { XIcon, PlusIcon } from "lucide-react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/animate-ui/components/radix/switch"
import { Checkbox } from "@/components/animate-ui/components/radix/checkbox"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { agentsApi } from "../api/agents"
import type {
  AgentDetail,
  AgentSummary,
  UserAgentCreateRequest,
  UserAgentUpdateRequest,
  UserAgentAllowedTool,
  AgentPermissionPolicy,
} from "../types"

type AgentFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent?: AgentDetail | null
  editingId?: string | null
  onSaved: () => void
}

const allowedToolOptions: { value: UserAgentAllowedTool; label: string }[] = [
  { value: "ls", label: "ls" },
  { value: "read_file", label: "read_file" },
  { value: "glob", label: "glob" },
  { value: "grep", label: "grep" },
]

const permissionOptions = {
  filesystem: [
    { value: "none", label: "无" },
    { value: "read", label: "只读" },
    { value: "write", label: "读写" },
  ],
  shell: [
    { value: "none", label: "无" },
    { value: "limited", label: "受限" },
    { value: "full", label: "完全" },
  ],
  network: [
    { value: "none", label: "无" },
    { value: "limited", label: "受限" },
    { value: "full", label: "完全" },
  ],
  deploy: [
    { value: "none", label: "无" },
    { value: "preview", label: "预览" },
    { value: "publish", label: "发布" },
  ],
}

export function AgentFormDialog({ open, onOpenChange, agent, editingId, onSaved }: AgentFormDialogProps) {
  const isEdit = !!agent
  const isLoading = !!editingId && !agent

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [systemPrompt, setSystemPrompt] = useState("")
  const [agentId, setAgentId] = useState("")
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [capInput, setCapInput] = useState("")
  const [allowedTools, setAllowedTools] = useState<UserAgentAllowedTool[]>([])
  const [permissionPolicy, setPermissionPolicy] = useState<AgentPermissionPolicy>({
    filesystem: "read",
    shell: "limited",
    network: "limited",
    deploy: "none",
    requiresApproval: false,
  })
  const [enabled, setEnabled] = useState(true)
  const [allowedSubagents, setAllowedSubagents] = useState<string[]>([])
  const [subagentOptions, setSubagentOptions] = useState<AgentSummary[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      if (agent) {
        setName(agent.name)
        setDescription(agent.description)
        setSystemPrompt(agent.systemPrompt ?? "")
        setAgentId(agent.id)
        setCapabilities([...agent.capabilities])
        setAllowedTools([...agent.allowedTools as UserAgentAllowedTool[]])
        setPermissionPolicy({ ...agent.permissionPolicy })
        setEnabled(agent.enabled)
        setAllowedSubagents([...agent.allowedSubagents])
        agentsApi.list({ tier: "subagent", allTiers: true }).then((data) => {
          setSubagentOptions(data.agents.filter((a) => a.visibility === "visible" && a.enabled))
        }).catch(() => {
          setSubagentOptions([])
        })
      } else {
        setName("")
        setDescription("")
        setSystemPrompt("")
        setAgentId("")
        setCapabilities([])
        setAllowedTools([])
        setPermissionPolicy({
          filesystem: "read",
          shell: "limited",
          network: "limited",
          deploy: "none",
          requiresApproval: false,
        })
        setEnabled(true)
        setAllowedSubagents([])
        setSubagentOptions([])
      }
      setCapInput("")
      setError(null)
    }
  }, [open, agent])

  const handleSubmit = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      if (isEdit && agent) {
        const body: UserAgentUpdateRequest = {}
        if (name !== agent.name) body.name = name
        if (description !== agent.description) body.description = description
        if (systemPrompt !== (agent.systemPrompt ?? "")) body.systemPrompt = systemPrompt
        if (enabled !== agent.enabled) body.enabled = enabled
        if (JSON.stringify(capabilities) !== JSON.stringify(agent.capabilities))
          body.capabilities = capabilities
        if (JSON.stringify(allowedTools) !== JSON.stringify(agent.allowedTools))
          body.allowedTools = allowedTools
        if (JSON.stringify(permissionPolicy) !== JSON.stringify(agent.permissionPolicy))
          body.permissionPolicy = permissionPolicy
        if (JSON.stringify(allowedSubagents) !== JSON.stringify(agent.allowedSubagents))
          body.allowedSubagents = allowedSubagents

        if (Object.keys(body).length === 0) {
          onOpenChange(false)
          return
        }
        await agentsApi.update(agent.id, body)
      } else {
        const body: UserAgentCreateRequest = {
          name,
          description,
          systemPrompt,
          capabilities,
          allowedTools,
          permissionPolicy,
          enabled,
          allowedSubagents,
        }
        if (agentId.trim()) {
          body.id = agentId.trim()
        }
        await agentsApi.create(body)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }, [isEdit, agent, name, description, systemPrompt, agentId, capabilities, allowedSubagents, allowedTools, permissionPolicy, enabled, onSaved, onOpenChange])

  const addCapability = useCallback(() => {
    const val = capInput.trim()
    if (val && !capabilities.includes(val)) {
      setCapabilities((prev) => [...prev, val])
    }
    setCapInput("")
  }, [capInput, capabilities])

  const removeCapability = useCallback((cap: string) => {
    setCapabilities((prev) => prev.filter((c) => c !== cap))
  }, [])

  const toggleTool = useCallback((tool: UserAgentAllowedTool) => {
    setAllowedTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
    )
  }, [])

  const toggleSubagent = useCallback((id: string) => {
    setAllowedSubagents((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    )
  }, [])

  const isReadonly = isEdit && agent?.readonly

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent from="top" className="w-[560px] h-[85vh] p-0 flex flex-col">
        <div className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>{isLoading ? "加载中..." : isEdit ? "编辑智能体" : "新增智能体"}</DialogTitle>
          <DialogDescription className="sr-only">
            {isEdit ? "修改智能体配置" : "创建自定义智能体"}
          </DialogDescription>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 pb-4 space-y-4">
            {isLoading ? (
              <>
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-8" />
                  <Skeleton className="h-9 w-full" />
                </div>
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-9 w-full" />
                </div>
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-9 w-full" />
                </div>
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-[120px] w-full" />
                </div>
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-16" />
                  <div className="flex gap-2">
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-6 w-16" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-16" />
                  <div className="grid grid-cols-2 gap-3">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                </div>
              </>
            ) : (
            <>
            {isEdit && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">ID</label>
                <Input value={agentId} disabled className="bg-muted" />
              </div>
            )}

            {!isEdit && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">ID</label>
                <Input
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  placeholder="留空自动生成 (规则：小写字母开头，仅允许 a-z 0-9 _ -)"
                  disabled={isReadonly}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">名称 *</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="智能体显示名称"
                disabled={isReadonly}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">描述 *</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="简短描述智能体的功能"
                disabled={isReadonly}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">系统提示词 *</label>
              <Textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="定义智能体的行为、角色和能力"
                className="min-h-[120px]"
                disabled={isReadonly}
              />
            </div>

            {isEdit && (
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">启用</label>
                <Switch
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  disabled={isReadonly}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">能力标签</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {capabilities.map((cap) => (
                  <Badge key={cap} variant="secondary" className="gap-1">
                    {cap}
                    {!isReadonly && (
                      <button
                        type="button"
                        onClick={() => removeCapability(cap)}
                        className="ml-0.5 hover:text-destructive"
                      >
                        <XIcon className="size-3" />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
              {!isReadonly && (
                <div className="flex gap-2">
                  <Input
                    value={capInput}
                    onChange={(e) => setCapInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        addCapability()
                      }
                    }}
                    placeholder="输入能力名称"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addCapability}
                  >
                    <PlusIcon className="size-4" />
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">允许的工具</label>
              <div className="flex flex-wrap gap-2">
                {allowedToolOptions.map((tool) => (
                  <label
                    key={tool.value}
                    className="flex items-center gap-1.5 text-sm cursor-pointer"
                  >
                    <Checkbox
                      checked={allowedTools.includes(tool.value)}
                      onCheckedChange={() => toggleTool(tool.value)}
                      disabled={isReadonly}
                      size="sm"
                    />
                    {tool.label}
                  </label>
                ))}
              </div>
            </div>

            {isEdit && subagentOptions.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">允许的子智能体</label>
                <div className="flex flex-wrap gap-2">
                  {subagentOptions.map((sub) => (
                    <label
                      key={sub.id}
                      className="flex items-center gap-1.5 text-sm cursor-pointer"
                    >
                      <Checkbox
                        checked={allowedSubagents.includes(sub.id)}
                        onCheckedChange={() => toggleSubagent(sub.id)}
                        disabled={isReadonly}
                        size="sm"
                      />
                      {sub.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">权限策略</label>
              <div className="grid grid-cols-2 gap-3">
                {(Object.keys(permissionOptions) as Array<keyof typeof permissionOptions>).map(
                  (key) => (
                    <div key={key} className="space-y-1">
                      <label className="text-xs text-muted-foreground capitalize">
                        {key === "filesystem"
                          ? "文件系统"
                          : key === "shell"
                            ? "Shell"
                            : key === "network"
                              ? "网络"
                              : "部署"}
                      </label>
                      <Select
                        value={permissionPolicy[key]}
                        onValueChange={(val) =>
                          setPermissionPolicy((prev) => ({
                            ...prev,
                            [key]: val,
                          }))
                        }
                        disabled={isReadonly}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {permissionOptions[key].map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )
                )}
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer mt-1">
                <Checkbox
                  checked={permissionPolicy.requiresApproval}
                  onCheckedChange={(checked) =>
                    setPermissionPolicy((prev) => ({
                      ...prev,
                      requiresApproval: checked === true,
                    }))
                  }
                  disabled={isReadonly}
                  size="sm"
                />
                需要审批
              </label>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            </>
            )}
          </div>
        </ScrollArea>

        {isReadonly ? (
          <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-2 border-t shrink-0">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-2 border-t shrink-0">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={saving || isLoading || !name.trim() || !description.trim() || !systemPrompt.trim()}>
              {saving ? "保存中..." : "保存"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
