import { useState, useEffect, useCallback } from "react"
import { XIcon, PlusIcon } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/animate-ui/components/radix/switch"
import { Checkbox } from "@/components/animate-ui/components/radix/checkbox"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { agentsApi } from "../api/agents"
import type {
  AgentDetail,
  UserAgentCreateRequest,
  UserAgentUpdateRequest,
  UserAgentAllowedTool,
  AgentPermissionPolicy,
  AuthoringOptionsResponse,
  AuthoringCapabilityTag,
} from "../types"

type AgentFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent?: AgentDetail | null
  editingId?: string | null
  onSaved: () => void
}

type SelectedCapability = {
  id: string
  name: string
  category: string
}

const KNOWN_CATEGORY_LABELS: Record<string, string> = {
  engineering: "工程开发",
  reasoning: "推理分析",
  creative: "创意生成",
  communication: "沟通协作",
  operations: "运维管理",
  analysis: "分析",
  writing: "写作",
  research: "研究",
  coding: "编程",
  design: "设计",
  planning: "规划",
  testing: "测试",
  devops: "DevOps",
  data: "数据",
  security: "安全",
  knowledge: "知识",
}

function getCategoryLabel(category: string): string {
  return KNOWN_CATEGORY_LABELS[category] ?? category
}

function deriveCategories(tags: AuthoringCapabilityTag[]) {
  const seen = new Set<string>()
  const result: { value: string; label: string }[] = []
  for (const tag of tags) {
    if (!seen.has(tag.category)) {
      seen.add(tag.category)
      result.push({ value: tag.category, label: getCategoryLabel(tag.category) })
    }
  }
  return result
}

const FILESYSTEM_OPTIONS = [
  { value: "none", label: "无" },
  { value: "read", label: "只读" },
  { value: "write", label: "读写" },
]

const SHELL_OPTIONS = [
  { value: "none", label: "无" },
  { value: "limited", label: "受限" },
  { value: "full", label: "完全" },
]

const NETWORK_OPTIONS = [
  { value: "none", label: "无" },
  { value: "limited", label: "受限" },
  { value: "full", label: "完全" },
]

const DEPLOY_OPTIONS = [
  { value: "none", label: "无" },
  { value: "preview", label: "预览" },
  { value: "publish", label: "发布" },
]

const RISK_LEVEL_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  low: { label: "低风险", variant: "secondary" },
  medium: { label: "中风险", variant: "outline" },
  high: { label: "高风险", variant: "destructive" },
}

let authoringCache: AuthoringOptionsResponse | null = null
let authoringPromise: Promise<AuthoringOptionsResponse> | null = null

function fetchAuthoringOptions(): Promise<AuthoringOptionsResponse> {
  if (authoringCache) return Promise.resolve(authoringCache)
  if (authoringPromise) return authoringPromise
  authoringPromise = agentsApi.authoringOptions().then((data) => {
    authoringCache = data
    return data
  })
  return authoringPromise
}

function resolveCapabilities(ids: string[], tags: AuthoringCapabilityTag[]): SelectedCapability[] {
  return ids.map((id) => {
    const tag = tags.find((t) => t.id === id)
    return tag ? { id: tag.id, name: tag.name, category: tag.category } : { id, name: id, category: "" }
  })
}

export function AgentFormDialog({ open, onOpenChange, agent, editingId, onSaved }: AgentFormDialogProps) {
  const isEdit = !!agent
  const isLoading = !!editingId && !agent

  const [authoring, setAuthoring] = useState<AuthoringOptionsResponse | null>(null)
  const [authoringLoading, setAuthoringLoading] = useState(false)

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [systemPrompt, setSystemPrompt] = useState("")
  const [agentId, setAgentId] = useState("")
  const [selectedCapabilities, setSelectedCapabilities] = useState<SelectedCapability[]>([])
  const [allowedTools, setAllowedTools] = useState<UserAgentAllowedTool[]>([])
  const [permissionPolicy, setPermissionPolicy] = useState<AgentPermissionPolicy>({
    filesystem: "none",
    shell: "none",
    network: "none",
    deploy: "none",
    requiresApproval: false,
  })
  const [enabled, setEnabled] = useState(true)
  const [allowedSubagents, setAllowedSubagents] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [capIdInput, setCapIdInput] = useState("")
  const [capNameInput, setCapNameInput] = useState("")
  const [capCategoryInput, setCapCategoryInput] = useState("")
  const [showCustomCapForm, setShowCustomCapForm] = useState(false)

  useEffect(() => {
    if (!open) return
    setAuthoringLoading(true)
    fetchAuthoringOptions()
      .then((data) => setAuthoring(data))
      .catch(() => setAuthoring(null))
      .finally(() => setAuthoringLoading(false))
  }, [open])

  useEffect(() => {
    if (!open || !authoring) return
    if (isEdit && agent) {
      setName(agent.name)
      setDescription(agent.description)
      setSystemPrompt(agent.systemPrompt ?? "")
      setAgentId(agent.id)
      setSelectedCapabilities(resolveCapabilities(agent.capabilities, authoring.capabilityTags))
      setAllowedTools([...agent.allowedTools as UserAgentAllowedTool[]])
      setPermissionPolicy({ ...agent.permissionPolicy })
      setEnabled(agent.enabled)
      setAllowedSubagents([...agent.allowedSubagents])
    } else {
      const defaults = authoring.defaults
      setName("")
      setDescription("")
      setSystemPrompt("")
      setAgentId("")
      setSelectedCapabilities([])
      setAllowedTools([...defaults.allowedTools as UserAgentAllowedTool[]])
      setPermissionPolicy({ ...defaults.permissionPolicy })
      setEnabled(true)
      setAllowedSubagents([...defaults.allowedSubagents])
    }
    setCapIdInput("")
    setCapNameInput("")
    setCapCategoryInput("")
    setShowCustomCapForm(false)
    setError(null)
  }, [open, authoring, agent, isEdit])

  const handleSubmit = useCallback(async () => {
    setSaving(true)
    setError(null)
    const capabilityIds = selectedCapabilities.map((c) => c.id)
    try {
      if (isEdit && agent) {
        const body: UserAgentUpdateRequest = {}
        if (name !== agent.name) body.name = name
        if (description !== agent.description) body.description = description
        if (systemPrompt !== (agent.systemPrompt ?? "")) body.systemPrompt = systemPrompt
        if (enabled !== agent.enabled) body.enabled = enabled
        if (JSON.stringify(capabilityIds) !== JSON.stringify(agent.capabilities))
          body.capabilities = capabilityIds
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
          capabilities: capabilityIds,
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
  }, [isEdit, agent, name, description, systemPrompt, agentId, selectedCapabilities, allowedSubagents, allowedTools, permissionPolicy, enabled, onSaved, onOpenChange])

  const toggleRecommendedCap = useCallback((tag: AuthoringCapabilityTag) => {
    setSelectedCapabilities((prev) => {
      if (prev.some((c) => c.id === tag.id)) {
        return prev.filter((c) => c.id !== tag.id)
      }
      return [...prev, { id: tag.id, name: tag.name, category: tag.category }]
    })
  }, [])

  const addCustomCap = useCallback(() => {
    const id = capIdInput.trim()
    const name = capNameInput.trim()
    const category = capCategoryInput
    if (!id || !name || !category) return
    if (selectedCapabilities.some((c) => c.id === id)) return
    setSelectedCapabilities((prev) => [...prev, { id, name, category }])
    setCapIdInput("")
    setCapNameInput("")
    setCapCategoryInput("")
    setShowCustomCapForm(false)
  }, [capIdInput, capNameInput, capCategoryInput, selectedCapabilities])

  const removeCapability = useCallback((id: string) => {
    setSelectedCapabilities((prev) => prev.filter((c) => c.id !== id))
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

  const hasWriteTools = allowedTools.some((t) => t === "write_file" || t === "edit_file")
  const hasReadTools = allowedTools.some((t) => t === "ls" || t === "read_file" || t === "glob" || "grep" === t)
  const needsWriteFs = hasWriteTools && permissionPolicy.filesystem !== "write"
  const needsReadFs = hasReadTools && permissionPolicy.filesystem === "none"

  const isReadonly = isEdit && agent?.readonly
  const loadingContent = authoringLoading || isLoading

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent from="top" className="w-[540px] h-[600px] p-0 flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>{loadingContent ? "加载中..." : isEdit ? "编辑智能体" : "新增智能体"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "修改智能体配置" : "创建自定义智能体"}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-4 px-6 pb-4">
          {loadingContent ? (
            <>
              <div className="space-y-2">
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-9 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-[100px] w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <div className="flex flex-wrap gap-2">
                  <Skeleton className="h-7 w-24" />
                  <Skeleton className="h-7 w-24" />
                  <Skeleton className="h-7 w-24" />
                </div>
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-8 w-full" />
              </div>
            </>
          ) : (
            <>
              {isEdit && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">ID</label>
                  <Input value={agentId} disabled className="bg-muted" />
                </div>
              )}

              {!isEdit && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">ID</label>
                  <Input
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                    placeholder="留空自动生成 (规则：小写字母开头，仅允许 a-z 0-9 _ -)"
                    disabled={isReadonly}
                  />
                  <p className="text-xs text-muted-foreground">
                    小写字母开头，仅允许小写字母、数字、下划线和连字符。
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">名称 *</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="智能体显示名称"
                  disabled={isReadonly}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">描述 *</label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="简短描述智能体的功能"
                  disabled={isReadonly}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">系统提示词 *</label>
                <Textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="定义智能体的行为、角色和能力"
                  className="min-h-[100px]"
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

              <div className="space-y-2">
                <label className="text-sm font-medium">能力标签</label>
                {selectedCapabilities.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCapabilities.map((cap) => (
                      <Badge key={cap.id} variant="secondary" className="gap-1">
                        {cap.name}
                        {cap.category && (
                          <span className="text-[10px] text-muted-foreground ml-0.5">
                            {getCategoryLabel(cap.category)}
                          </span>
                        )}
                        {!isReadonly && (
                          <button
                            type="button"
                            onClick={() => removeCapability(cap.id)}
                            className="ml-0.5 hover:text-destructive"
                          >
                            <XIcon className="size-3" />
                          </button>
                        )}
                      </Badge>
                    ))}
                  </div>
                )}
                {authoring && authoring.capabilityTags.length > 0 && !isReadonly && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">推荐标签（点击添加）</p>
                    <div className="flex flex-wrap gap-1.5">
                      {authoring.capabilityTags.map((tag) => {
                        const isSelected = selectedCapabilities.some((c) => c.id === tag.id)
                        return (
                          <Badge
                            key={tag.id}
                            variant={isSelected ? "default" : "outline"}
                            className="cursor-pointer select-none"
                            onClick={() => toggleRecommendedCap(tag)}
                          >
                            {tag.name}
                            <span className="text-[10px] text-muted-foreground ml-0.5">
                              {getCategoryLabel(tag.category)}
                            </span>
                          </Badge>
                        )
                      })}
                    </div>
                  </div>
                )}
                {!isReadonly && (
                  <div className="space-y-2">
                    {!showCustomCapForm ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        onClick={() => setShowCustomCapForm(true)}
                      >
                        <PlusIcon className="size-3" />
                        添加自定义标签
                      </Button>
                    ) : (
                      <div className="rounded-md border p-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">ID *</label>
                            <Input
                              value={capIdInput}
                              onChange={(e) => setCapIdInput(e.target.value)}
                              placeholder="e.g. data_analysis"
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">名称 *</label>
                            <Input
                              value={capNameInput}
                              onChange={(e) => setCapNameInput(e.target.value)}
                              placeholder="e.g. 数据分析"
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">类别 *</label>
                          <Select value={capCategoryInput} onValueChange={setCapCategoryInput}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="选择类别" />
                            </SelectTrigger>
                            <SelectContent>
                              {deriveCategories(authoring?.capabilityTags ?? []).map((cat) => (
                                <SelectItem key={cat.value} value={cat.value}>
                                  {cat.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              setShowCustomCapForm(false)
                              setCapIdInput("")
                              setCapNameInput("")
                              setCapCategoryInput("")
                            }}
                          >
                            取消
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={!capIdInput.trim() || !capNameInput.trim() || !capCategoryInput}
                            onClick={addCustomCap}
                          >
                            确认
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">可用工具</label>
                <div className="space-y-1.5">
                  {authoring?.tools.map((tool) => {
                    const checked = allowedTools.includes(tool.id as UserAgentAllowedTool)
                    const riskBadge = RISK_LEVEL_BADGE[tool.riskLevel] ?? RISK_LEVEL_BADGE.low
                    return (
                      <label
                        key={tool.id}
                        className="flex items-start gap-2.5 rounded-md border p-2.5 text-sm cursor-pointer has-[:disabled]:opacity-50 has-[:disabled]:cursor-default"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleTool(tool.id as UserAgentAllowedTool)}
                          disabled={isReadonly}
                          size="sm"
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{tool.name}</span>
                            <Badge variant={riskBadge.variant} className="text-[10px] h-4 px-1.5">
                              {riskBadge.label}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground">
                              {getCategoryLabel(tool.category)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                            {tool.description}
                          </p>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>

              {authoring && authoring.subagents.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">子智能体</label>
                  <div className="space-y-1.5">
                    {authoring.subagents.map((sub) => (
                      <label
                        key={sub.id}
                        className="flex items-start gap-2.5 rounded-md border p-2.5 text-sm cursor-pointer has-[:disabled]:opacity-50 has-[:disabled]:cursor-default"
                      >
                        <Checkbox
                          checked={allowedSubagents.includes(sub.id)}
                          onCheckedChange={() => toggleSubagent(sub.id)}
                          disabled={isReadonly}
                          size="sm"
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{sub.name}</div>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                            {sub.description}
                          </p>
                          {sub.capabilities.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {sub.capabilities.map((cap) => (
                                <Badge key={cap} variant="secondary" className="text-[10px] h-4 px-1.5">
                                  {cap}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">权限策略</label>
                <div className="rounded-md border p-3 space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">文件系统</label>
                    <Select
                      value={permissionPolicy.filesystem}
                      onValueChange={(val) =>
                        setPermissionPolicy((prev) => ({ ...prev, filesystem: val as AgentPermissionPolicy["filesystem"] }))
                      }
                      disabled={isReadonly}
                    >
                      <SelectTrigger className="h-8 text-xs w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FILESYSTEM_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {needsWriteFs && (
                      <p className="text-[11px] text-amber-600">
                        已选择写入工具，文件系统权限应至少为「读写」
                      </p>
                    )}
                    {needsReadFs && (
                      <p className="text-[11px] text-amber-600">
                        已选择读取工具，文件系统权限应至少为「只读」
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Shell</label>
                      <Select
                        value={permissionPolicy.shell}
                        onValueChange={(val) =>
                          setPermissionPolicy((prev) => ({ ...prev, shell: val as AgentPermissionPolicy["shell"] }))
                        }
                        disabled={isReadonly}
                      >
                        <SelectTrigger className="h-8 text-xs w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SHELL_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">网络</label>
                      <Select
                        value={permissionPolicy.network}
                        onValueChange={(val) =>
                          setPermissionPolicy((prev) => ({ ...prev, network: val as AgentPermissionPolicy["network"] }))
                        }
                        disabled={isReadonly}
                      >
                        <SelectTrigger className="h-8 text-xs w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {NETWORK_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">部署</label>
                      <Select
                        value={permissionPolicy.deploy}
                        onValueChange={(val) =>
                          setPermissionPolicy((prev) => ({ ...prev, deploy: val as AgentPermissionPolicy["deploy"] }))
                        }
                        disabled={isReadonly}
                      >
                        <SelectTrigger className="h-8 text-xs w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DEPLOY_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
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
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </>
          )}
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 pb-6 pt-2">
          {isReadonly ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button onClick={handleSubmit} disabled={saving || loadingContent || !name.trim() || !description.trim() || !systemPrompt.trim()}>
                {saving ? "保存中..." : "保存"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
