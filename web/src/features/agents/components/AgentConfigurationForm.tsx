import { useCallback, useEffect, useRef, useState } from "react"
import { PlusIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Checkbox } from "@/components/animate-ui/components/radix/checkbox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"

import { agentsApi } from "../api/agents"
import type {
  AgentDetail,
  AgentPermissionPolicy,
  AuthoringOptionsResponse,
  UserAgentAllowedTool,
  UserAgentCreateRequest,
  UserAgentUpdateRequest,
} from "../types"
import { AgentModelControl } from "./AgentModelControl"

type AgentConfigurationFormProps = {
  active: boolean
  agent?: AgentDetail | null
  canConfigureModel?: boolean
  mode: "create" | "edit"
  onCancel?: () => void
  onConfigureModel?: () => void
  onSaved: (agent: AgentDetail) => void
}

const FILESYSTEM_OPTIONS: Array<{
  label: string
  value: AgentPermissionPolicy["filesystem"]
}> = [
  { label: "无", value: "none" },
  { label: "只读", value: "read" },
  { label: "读写", value: "write" },
]

const DEFAULT_POLICY: AgentPermissionPolicy = {
  deploy: "none",
  filesystem: "none",
  network: "none",
  shell: "none",
}

const READ_TOOLS: UserAgentAllowedTool[] = ["ls", "read_file", "glob", "grep"]
const WRITE_TOOLS: UserAgentAllowedTool[] = ["write_file", "edit_file"]

let authoringCache: AuthoringOptionsResponse | null = null
let authoringPromise: Promise<AuthoringOptionsResponse> | null = null

function fetchAuthoringOptions(): Promise<AuthoringOptionsResponse> {
  if (authoringCache) {
    return Promise.resolve(authoringCache)
  }

  if (authoringPromise) {
    return authoringPromise
  }

  authoringPromise = agentsApi.authoringOptions().then((options) => {
    authoringCache = options
    return options
  })

  return authoringPromise
}

function FormSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

export function AgentConfigurationForm({
  active,
  agent,
  canConfigureModel = false,
  mode,
  onCancel,
  onConfigureModel,
  onSaved,
}: AgentConfigurationFormProps) {
  const isEdit = mode === "edit"
  const defaultsAppliedRef = useRef(isEdit)
  const [authoring, setAuthoring] = useState<AuthoringOptionsResponse | null>(
    authoringCache
  )
  const [authoringLoading, setAuthoringLoading] = useState(!authoringCache)
  const [agentId, setAgentId] = useState(agent?.id ?? "")
  const [name, setName] = useState(agent?.name ?? "")
  const [description, setDescription] = useState(agent?.description ?? "")
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? "")
  const [capabilities, setCapabilities] = useState<string[]>(
    agent?.capabilities ?? []
  )
  const [customCapability, setCustomCapability] = useState("")
  const [allowedTools, setAllowedTools] = useState<UserAgentAllowedTool[]>(
    (agent?.allowedTools as UserAgentAllowedTool[] | undefined) ?? []
  )
  const [allowedSubagents, setAllowedSubagents] = useState<string[]>(
    agent?.allowedSubagents ?? []
  )
  const [permissionPolicy, setPermissionPolicy] = useState<AgentPermissionPolicy>(
    agent?.permissionPolicy ?? DEFAULT_POLICY
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!active) {
      return
    }

    if (authoringCache) {
      const timer = window.setTimeout(() => {
        setAuthoring(authoringCache)
        setAuthoringLoading(false)
      }, 0)
      return () => window.clearTimeout(timer)
    }

    let cancelled = false
    void fetchAuthoringOptions()
      .then((options) => {
        if (!cancelled) {
          setAuthoring(options)
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast.error("加载智能体配置选项失败")
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthoringLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [active])

  useEffect(() => {
    if (mode !== "create" || !authoring || defaultsAppliedRef.current) {
      return
    }

    const timer = window.setTimeout(() => {
      defaultsAppliedRef.current = true
      setAllowedTools(authoring.defaults.allowedTools as UserAgentAllowedTool[])
      setAllowedSubagents(authoring.defaults.allowedSubagents)
      setPermissionPolicy(authoring.defaults.permissionPolicy)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [authoring, mode])

  const toggleCapability = useCallback((id: string) => {
    setCapabilities((current) =>
      current.includes(id)
        ? current.filter((capability) => capability !== id)
        : [...current, id]
    )
  }, [])

  const handleAddCapability = useCallback(() => {
    const capability = customCapability.trim()
    if (!capability || capabilities.includes(capability)) {
      return
    }

    setCapabilities((current) => [...current, capability])
    setCustomCapability("")
  }, [capabilities, customCapability])

  const toggleTool = useCallback((tool: UserAgentAllowedTool) => {
    setAllowedTools((current) =>
      current.includes(tool)
        ? current.filter((item) => item !== tool)
        : [...current, tool]
    )
  }, [])

  const toggleSubagent = useCallback((subagentId: string) => {
    setAllowedSubagents((current) =>
      current.includes(subagentId)
        ? current.filter((id) => id !== subagentId)
        : [...current, subagentId]
    )
  }, [])

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      if (!isEdit && agentId.trim() && !/^[a-z][a-z0-9_-]*$/.test(agentId.trim())) {
        toast.error("ID 必须以小写字母开头，仅允许小写字母、数字、下划线和连字符")
        return
      }

      const requiresRead = allowedTools.some((tool) => READ_TOOLS.includes(tool))
      const requiresWrite = allowedTools.some((tool) => WRITE_TOOLS.includes(tool))
      if (requiresRead && permissionPolicy.filesystem === "none") {
        toast.error("已选择读取工具，文件系统权限应至少为「只读」")
        return
      }
      if (requiresWrite && permissionPolicy.filesystem !== "write") {
        toast.error("已选择写入工具，文件系统权限必须为「读写」")
        return
      }

      setSaving(true)
      try {
        let savedAgent: AgentDetail
        if (isEdit && agent) {
          const input: UserAgentUpdateRequest = {
            allowedSubagents,
            allowedTools,
            capabilities,
            description,
            name,
            permissionPolicy,
            systemPrompt,
          }
          savedAgent = await agentsApi.update(agent.id, input)
        } else {
          const input: UserAgentCreateRequest = {
            allowedSubagents,
            allowedTools,
            capabilities,
            description,
            enabled: true,
            name,
            permissionPolicy,
            systemPrompt,
          }
          if (agentId.trim()) {
            input.id = agentId.trim()
          }
          savedAgent = await agentsApi.create(input)
        }

        onSaved(savedAgent)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "保存失败")
      } finally {
        setSaving(false)
      }
    },
    [
      agent,
      agentId,
      allowedSubagents,
      allowedTools,
      capabilities,
      description,
      isEdit,
      name,
      onSaved,
      permissionPolicy,
      systemPrompt,
    ]
  )

  if (authoringLoading && !authoring) {
    return <FormSkeleton />
  }

  const requiresRead = allowedTools.some((tool) => READ_TOOLS.includes(tool))
  const requiresWrite = allowedTools.some((tool) => WRITE_TOOLS.includes(tool))

  return (
    <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={`${mode}-agent-id`}>
          ID
        </label>
        <Input
          disabled={isEdit}
          id={`${mode}-agent-id`}
          onChange={(event) => setAgentId(event.currentTarget.value)}
          placeholder="留空自动生成"
          value={agentId}
        />
        {isEdit ? null : (
          <p className="text-muted-foreground text-xs">
            小写字母开头，仅允许小写字母、数字、下划线和连字符。
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={`${mode}-agent-name`}>
          名称
        </label>
        <Input
          id={`${mode}-agent-name`}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="智能体显示名称"
          required
          value={name}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={`${mode}-agent-description`}>
          描述
        </label>
        <Input
          id={`${mode}-agent-description`}
          onChange={(event) => setDescription(event.currentTarget.value)}
          placeholder="简短描述智能体的职责"
          required
          value={description}
        />
      </div>

      {isEdit && agent && agent.origin !== "external" ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">模型绑定</span>
          <AgentModelControl
            agent={agent}
            disabled={!canConfigureModel}
            onConfigure={onConfigureModel}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={`${mode}-agent-prompt`}>
          系统提示词
        </label>
        <Textarea
          className="min-h-28"
          id={`${mode}-agent-prompt`}
          onChange={(event) => setSystemPrompt(event.currentTarget.value)}
          placeholder="定义智能体的行为、角色和能力"
          required
          value={systemPrompt}
        />
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium">能力标签</span>
        {capabilities.length === 0 ? null : (
          <div className="flex flex-wrap gap-2">
            {capabilities.map((capability) => (
              <Badge key={capability} variant="secondary">
                {capability}
                <button
                  aria-label={`移除 ${capability}`}
                  onClick={() => toggleCapability(capability)}
                  type="button"
                >
                  <XIcon />
                </button>
              </Badge>
            ))}
          </div>
        )}
        {authoring?.capabilityTags.length ? (
          <div className="flex flex-wrap gap-2">
            {authoring.capabilityTags.map((tag) => (
              <Button
                key={tag.id}
                onClick={() => toggleCapability(tag.id)}
                size="xs"
                type="button"
                variant={capabilities.includes(tag.id) ? "secondary" : "outline"}
              >
                {tag.name}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <Input
            onChange={(event) => setCustomCapability(event.currentTarget.value)}
            placeholder="自定义标签 ID"
            value={customCapability}
          />
          <Button
            disabled={!customCapability.trim()}
            onClick={handleAddCapability}
            type="button"
            variant="outline"
          >
            <PlusIcon data-icon="inline-start" />
            添加
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">可用工具</span>
        <div className="flex flex-col gap-2">
          {authoring?.tools.map((tool) => {
            const toolId = tool.id as UserAgentAllowedTool
            return (
              <label
                className="flex items-start gap-3 rounded-lg border p-3 text-sm"
                key={tool.id}
              >
                <Checkbox
                  checked={allowedTools.includes(toolId)}
                  onCheckedChange={() => toggleTool(toolId)}
                  size="sm"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{tool.name}</span>
                    <Badge variant={tool.riskLevel === "high" ? "destructive" : "secondary"}>
                      {tool.riskLevel}
                    </Badge>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {tool.description}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </div>

      {authoring?.subagents.length ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">可委派子智能体</span>
          <div className="flex flex-col gap-2">
            {authoring.subagents.map((subagent) => (
              <label
                className="flex items-start gap-3 rounded-lg border p-3 text-sm"
                key={subagent.id}
              >
                <Checkbox
                  checked={allowedSubagents.includes(subagent.id)}
                  onCheckedChange={() => toggleSubagent(subagent.id)}
                  size="sm"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-medium">{subagent.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {subagent.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={`${mode}-filesystem-policy`}>
          文件系统权限
        </label>
        <Select
          onValueChange={(value) =>
            setPermissionPolicy((current) => ({
              ...current,
              filesystem: value as AgentPermissionPolicy["filesystem"],
            }))
          }
          value={permissionPolicy.filesystem}
        >
          <SelectTrigger className="w-full" id={`${mode}-filesystem-policy`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {FILESYSTEM_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {requiresWrite && permissionPolicy.filesystem !== "write" ? (
          <p className="text-destructive text-xs">
            写入工具需要将文件系统权限设为读写。
          </p>
        ) : null}
        {requiresRead && permissionPolicy.filesystem === "none" ? (
          <p className="text-destructive text-xs">
            读取工具需要将文件系统权限设为只读或读写。
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          当前用户自定义智能体不开放 Shell、网络或部署权限配置。
        </p>
      </div>

      <div className="flex justify-end gap-2 border-border border-t pt-4">
        {onCancel ? (
          <Button onClick={onCancel} type="button" variant="outline">
            取消
          </Button>
        ) : null}
        <Button
          disabled={saving || !name.trim() || !description.trim() || !systemPrompt.trim()}
          type="submit"
        >
          {saving ? "保存中..." : isEdit ? "保存修改" : "创建智能体"}
        </Button>
      </div>
    </form>
  )
}
