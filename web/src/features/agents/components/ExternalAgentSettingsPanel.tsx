import { useEffect, useMemo, useRef, useState } from "react"
import { AlertCircleIcon, RefreshCwIcon, SaveIcon } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
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
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { conversationsApi } from "@/features/workbench/api/conversations"
import type { ConversationListItem } from "@/features/workbench/types"

import { agentsApi } from "../api/agents"
import {
  buildClaudeCodeExternalSettingsPayload,
  buildCodexExternalSettingsPayload,
  buildExternalSettingsUpdateInput,
  buildOpenCodeExternalSettingsPayload,
  filterExternalSettingsForProvider,
  resolveExternalSettingsProvider,
} from "../external-agent-settings-state"
import type {
  AgentDetail,
  ClaudeCodePermissionMode,
  ExternalAgentSettings,
  OpenCodeExecutionAgent,
  OpenCodeModelCatalogItem,
  OpenCodeModelRef,
} from "../types"

type ExternalAgentSettingsPanelProps = {
  agent: AgentDetail
}

const SDK_DEFAULT_MODEL = "__sdk_default__"

const permissionModeLabels: Record<ClaudeCodePermissionMode, string> = {
  acceptEdits: "自动接受编辑",
  auto: "自动判断",
  default: "默认",
  dontAsk: "不询问",
  plan: "计划模式",
}

const permissionModeDescriptions: Record<ClaudeCodePermissionMode, string> = {
  acceptEdits: "非默认自动化模式，会自动接受编辑。",
  auto: "非默认自动化模式，部分权限交给 Claude Code 判断。",
  default: "使用 Claude Code 默认危险操作判断。",
  dontAsk: "减少交互确认，适合低风险任务。",
  plan: "偏向计划与说明，不主动执行编辑。",
}

function encodeOpenCodeModelKey(model: OpenCodeModelRef): string {
  return JSON.stringify([model.providerID, model.modelID])
}

function decodeOpenCodeModelKey(value: string): OpenCodeModelRef | null {
  if (value === SDK_DEFAULT_MODEL) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { providerID: parsed[0], modelID: parsed[1] }
    }
  } catch {
    return null
  }

  return null
}

function formatCatalogModel(model: OpenCodeModelCatalogItem): string {
  const provider = model.providerName ?? model.providerID
  const name = model.modelName ?? model.modelID
  return `${provider} / ${name}`
}

function applySettingsToForm(
  settings: ExternalAgentSettings,
  setExecutionAgent: (value: OpenCodeExecutionAgent) => void,
  setOpenCodeModelKey: (value: string) => void,
  setClaudeModel: (value: string) => void,
  setPermissionMode: (value: ClaudeCodePermissionMode) => void,
  setCodexModel: (value: string) => void
) {
  if (settings.provider === "opencode") {
    setExecutionAgent(settings.executionAgent ?? "build")
    setOpenCodeModelKey(
      settings.model
        ? encodeOpenCodeModelKey(settings.model)
        : SDK_DEFAULT_MODEL
    )
    return
  }

  if (settings.provider === "claude-code") {
    setClaudeModel(settings.model ?? "")
    setPermissionMode(settings.permissionMode ?? "default")
    return
  }

  setCodexModel(settings.model ?? "")
}

function resetSettingsForm(
  setExecutionAgent: (value: OpenCodeExecutionAgent) => void,
  setOpenCodeModelKey: (value: string) => void,
  setClaudeModel: (value: string) => void,
  setPermissionMode: (value: ClaudeCodePermissionMode) => void,
  setCodexModel: (value: string) => void
) {
  setExecutionAgent("build")
  setOpenCodeModelKey(SDK_DEFAULT_MODEL)
  setClaudeModel("")
  setPermissionMode("default")
  setCodexModel("")
}

function OpenCodeSettingsFields({
  catalogLoading,
  catalogModels,
  catalogWarnings,
  conversations,
  conversationsLoading,
  executionAgent,
  modelKey,
  onConversationChange,
  onExecutionAgentChange,
  onLoadCatalog,
  onModelChange,
  selectedConversationId,
}: {
  catalogLoading: boolean
  catalogModels: OpenCodeModelCatalogItem[]
  catalogWarnings: string[]
  conversations: ConversationListItem[]
  conversationsLoading: boolean
  executionAgent: OpenCodeExecutionAgent
  modelKey: string
  onConversationChange: (value: string) => void
  onExecutionAgentChange: (value: OpenCodeExecutionAgent) => void
  onLoadCatalog: () => void
  onModelChange: (value: string) => void
  selectedConversationId: string
}) {
  const selectedModel = decodeOpenCodeModelKey(modelKey)
  const selectedModelInCatalog = selectedModel
    ? catalogModels.some(
        (model) =>
          model.providerID === selectedModel.providerID &&
          model.modelID === selectedModel.modelID
      )
    : true

  return (
    <FieldGroup>
      <Field>
        <FieldLabel>执行智能体</FieldLabel>
        <ToggleGroup
          aria-label="OpenCode 执行智能体"
          className="flex-wrap"
          onValueChange={(value) => {
            if (value) {
              onExecutionAgentChange(value as OpenCodeExecutionAgent)
            }
          }}
          type="single"
          value={executionAgent}
          variant="outline"
        >
          <ToggleGroupItem value="build">build</ToggleGroupItem>
          <ToggleGroupItem value="plan">plan</ToggleGroupItem>
        </ToggleGroup>
      </Field>

      <Field>
        <FieldLabel>目录工作区上下文</FieldLabel>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            disabled={conversationsLoading || conversations.length === 0}
            onValueChange={onConversationChange}
            value={selectedConversationId}
          >
            <SelectTrigger className="min-w-0 flex-1">
              <SelectValue
                placeholder={conversationsLoading ? "加载会话中" : "选择活动会话"}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {conversations.map((conversation) => (
                  <SelectItem key={conversation.id} value={conversation.id}>
                    {conversation.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            disabled={!selectedConversationId || catalogLoading}
            onClick={onLoadCatalog}
            type="button"
            variant="outline"
          >
            {catalogLoading ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            加载目录
          </Button>
        </div>
        <FieldDescription>
          浏览器只发送 conversationId，由 HubServer 解析工作区。
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel>模型</FieldLabel>
        <Select onValueChange={onModelChange} value={modelKey}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={SDK_DEFAULT_MODEL}>SDK 默认</SelectItem>
              {selectedModel && !selectedModelInCatalog ? (
                <SelectItem value={modelKey}>
                  {selectedModel.providerID} / {selectedModel.modelID}
                </SelectItem>
              ) : null}
              {catalogModels.map((model) => (
                <SelectItem
                  key={encodeOpenCodeModelKey(model)}
                  value={encodeOpenCodeModelKey(model)}
                >
                  {formatCatalogModel(model)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          模型候选来自 OpenCode SDK catalog；选择 SDK 默认会清除覆盖。
        </FieldDescription>
      </Field>

      {catalogWarnings.length > 0 ? (
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>目录提示</AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {catalogWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </FieldGroup>
  )
}

export function ExternalAgentSettingsPanel({
  agent,
}: ExternalAgentSettingsPanelProps) {
  const provider = resolveExternalSettingsProvider(agent)
  const initialSettings = provider
    ? filterExternalSettingsForProvider(provider, agent.externalSettings)
    : null
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<ExternalAgentSettings | null>(
    initialSettings
  )
  const [executionAgent, setExecutionAgent] =
    useState<OpenCodeExecutionAgent>("build")
  const [openCodeModelKey, setOpenCodeModelKey] = useState(SDK_DEFAULT_MODEL)
  const [claudeModel, setClaudeModel] = useState("")
  const [permissionMode, setPermissionMode] =
    useState<ClaudeCodePermissionMode>("default")
  const [codexModel, setCodexModel] = useState("")
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [conversationsLoading, setConversationsLoading] = useState(false)
  const [selectedConversationId, setSelectedConversationId] = useState("")
  const [catalogModels, setCatalogModels] = useState<OpenCodeModelCatalogItem[]>(
    []
  )
  const [catalogWarnings, setCatalogWarnings] = useState<string[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const openCodeCatalogRequestIdRef = useRef(0)
  const selectedConversationIdRef = useRef(selectedConversationId)

  useEffect(() => {
    if (selectedConversationIdRef.current === selectedConversationId) {
      return
    }

    selectedConversationIdRef.current = selectedConversationId
    openCodeCatalogRequestIdRef.current += 1
    setCatalogLoading(false)
  }, [selectedConversationId])

  useEffect(() => {
    if (!provider) {
      return
    }

    let cancelled = false
    const cachedSettings = filterExternalSettingsForProvider(
      provider,
      agent.externalSettings
    )
    setLoading(true)
    setError(null)
    resetSettingsForm(
      setExecutionAgent,
      setOpenCodeModelKey,
      setClaudeModel,
      setPermissionMode,
      setCodexModel
    )
    setSettings(cachedSettings)
    if (cachedSettings) {
      applySettingsToForm(
        cachedSettings,
        setExecutionAgent,
        setOpenCodeModelKey,
        setClaudeModel,
        setPermissionMode,
        setCodexModel
      )
    }

    agentsApi
      .getExternalSettings(agent.id)
      .then((response) => {
        if (cancelled) {
          return
        }
        const nextSettings = filterExternalSettingsForProvider(
          provider,
          response.settings
        )
        if (!nextSettings) {
          resetSettingsForm(
            setExecutionAgent,
            setOpenCodeModelKey,
            setClaudeModel,
            setPermissionMode,
            setCodexModel
          )
          setSettings(null)
          setError("外部设置与当前智能体适配器不匹配")
          return
        }

        setSettings(nextSettings)
        applySettingsToForm(
          nextSettings,
          setExecutionAgent,
          setOpenCodeModelKey,
          setClaudeModel,
          setPermissionMode,
          setCodexModel
        )
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载外部设置失败")
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [agent.externalSettings, agent.id, provider])

  useEffect(() => {
    if (provider !== "opencode") {
      openCodeCatalogRequestIdRef.current += 1
      setConversations([])
      setSelectedConversationId("")
      setCatalogModels([])
      setCatalogWarnings([])
      setConversationsLoading(false)
      setCatalogLoading(false)
      return
    }

    let cancelled = false
    setConversationsLoading(true)
    conversationsApi
      .list("active")
      .then((items) => {
        if (cancelled) {
          return
        }
        setConversations(items)
        setSelectedConversationId((current) =>
          current && items.some((item) => item.id === current)
            ? current
            : items[0]?.id || ""
        )
      })
      .catch(() => {
        if (!cancelled) {
          setConversations([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setConversationsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [provider])

  const currentSummary = useMemo(() => {
    if (!settings) {
      return "尚未加载当前 SDK 设置"
    }

    if (settings.provider === "opencode") {
      const model = settings.model
        ? `${settings.model.providerID} / ${settings.model.modelID}`
        : "SDK 默认"
      return `${settings.executionAgent ?? "build"} · ${model}`
    }

    if (settings.provider === "claude-code") {
      return `${settings.model ?? "SDK 默认"} · ${
        permissionModeLabels[settings.permissionMode ?? "default"]
      }`
    }

    return settings.model ?? "SDK 默认"
  }, [settings])

  const loadOpenCodeCatalog = async () => {
    const requestedConversationId = selectedConversationId
    if (!requestedConversationId) {
      return
    }

    const requestId = openCodeCatalogRequestIdRef.current + 1
    openCodeCatalogRequestIdRef.current = requestId
    setCatalogLoading(true)
    try {
      const catalog =
        await agentsApi.listOpenCodeModelCatalog(requestedConversationId)
      if (
        openCodeCatalogRequestIdRef.current !== requestId ||
        selectedConversationIdRef.current !== requestedConversationId
      ) {
        return
      }
      setCatalogModels(catalog.models)
      setCatalogWarnings(catalog.warnings)
    } catch (err) {
      if (
        openCodeCatalogRequestIdRef.current === requestId &&
        selectedConversationIdRef.current === requestedConversationId
      ) {
        toast.error(err instanceof Error ? err.message : "加载 OpenCode 模型目录失败")
        setCatalogModels([])
        setCatalogWarnings([])
      }
    } finally {
      if (
        openCodeCatalogRequestIdRef.current === requestId &&
        selectedConversationIdRef.current === requestedConversationId
      ) {
        setCatalogLoading(false)
      }
    }
  }

  const handleOpenCodeConversationChange = (conversationId: string) => {
    openCodeCatalogRequestIdRef.current += 1
    setSelectedConversationId(conversationId)
    setCatalogModels([])
    setCatalogWarnings([])
    setCatalogLoading(false)
    const savedOpenCodeSettings = filterExternalSettingsForProvider(
      "opencode",
      settings
    )
    setOpenCodeModelKey(
      savedOpenCodeSettings?.model
        ? encodeOpenCodeModelKey(savedOpenCodeSettings.model)
        : SDK_DEFAULT_MODEL
    )
  }

  const buildPayload = (): ExternalAgentSettings | null => {
    if (provider === "opencode") {
      return buildOpenCodeExternalSettingsPayload({
        executionAgent,
        model: decodeOpenCodeModelKey(openCodeModelKey),
      })
    }

    if (provider === "claude-code") {
      return buildClaudeCodeExternalSettingsPayload({
        model: claudeModel,
        permissionMode,
      })
    }

    if (provider === "codex") {
      return buildCodexExternalSettingsPayload({ model: codexModel })
    }

    return null
  }

  const save = async () => {
    const payload = buildPayload()
    if (!provider || !payload) {
      return
    }

    const input = buildExternalSettingsUpdateInput(
      payload,
      selectedConversationId
    )
    if (!input) {
      const message = "选择 OpenCode 模型覆盖前，请先选择会话用于目录校验。"
      toast.error(message)
      return
    }

    setSaving(true)
    try {
      const response = await agentsApi.updateExternalSettings(agent.id, input)
      const nextSettings = filterExternalSettingsForProvider(
        provider,
        response.settings
      )
      if (!nextSettings) {
        setError("外部设置与当前智能体适配器不匹配")
        toast.error("保存结果与当前智能体适配器不匹配")
        return
      }

      setError(null)
      setSettings(nextSettings)
      applySettingsToForm(
        nextSettings,
        setExecutionAgent,
        setOpenCodeModelKey,
        setClaudeModel,
        setPermissionMode,
        setCodexModel
      )
      toast.success("外部 SDK 设置已保存")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存外部 SDK 设置失败")
    } finally {
      setSaving(false)
    }
  }

  if (!provider) {
    return (
      <Alert>
        <AlertCircleIcon />
        <AlertTitle>暂不支持</AlertTitle>
        <AlertDescription>
          当前外部适配器还没有可配置的 SDK 设置面板。
        </AlertDescription>
      </Alert>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3 rounded-lg bg-muted/60 p-3">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg bg-muted/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">外部 SDK</Badge>
            <span className="text-sm font-medium">{currentSummary}</span>
          </div>
          <p className="text-muted-foreground text-xs">
            这些设置只作用于 AgentHub 发起的运行，不写入外部工具全局配置。
          </p>
        </div>
        <Button
          disabled={saving || Boolean(error)}
          onClick={() => void save()}
          type="button"
        >
          {saving ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <SaveIcon data-icon="inline-start" />
          )}
          保存
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {provider === "opencode" ? (
        <OpenCodeSettingsFields
          catalogLoading={catalogLoading}
          catalogModels={catalogModels}
          catalogWarnings={catalogWarnings}
          conversations={conversations}
          conversationsLoading={conversationsLoading}
          executionAgent={executionAgent}
          modelKey={openCodeModelKey}
          onConversationChange={handleOpenCodeConversationChange}
          onExecutionAgentChange={setExecutionAgent}
          onLoadCatalog={() => void loadOpenCodeCatalog()}
          onModelChange={setOpenCodeModelKey}
          selectedConversationId={selectedConversationId}
        />
      ) : null}

      {provider === "claude-code" ? (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="claude-code-model">模型</FieldLabel>
            <Input
              id="claude-code-model"
              onChange={(event) => setClaudeModel(event.target.value)}
              placeholder="留空使用 SDK 默认"
              value={claudeModel}
            />
            <FieldDescription>可选；留空保存时会省略 model。</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>权限模式</FieldLabel>
            <ToggleGroup
              aria-label="Claude Code 权限模式"
              className="flex-wrap"
              onValueChange={(value) => {
                if (value) {
                  setPermissionMode(value as ClaudeCodePermissionMode)
                }
              }}
              type="single"
              value={permissionMode}
              variant="outline"
            >
              {Object.entries(permissionModeLabels).map(([value, label]) => (
                <ToggleGroupItem key={value} value={value}>
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>
              {permissionModeDescriptions[permissionMode]}
            </FieldDescription>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">acceptEdits：自动接受编辑</Badge>
            <Badge variant="outline">auto：自动权限判断</Badge>
          </div>
        </FieldGroup>
      ) : null}

      {provider === "codex" ? (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="codex-model">模型</FieldLabel>
            <Input
              id="codex-model"
              onChange={(event) => setCodexModel(event.target.value)}
              placeholder="留空使用 SDK 默认"
              value={codexModel}
            />
            <FieldDescription>仅支持 model 覆盖；留空保存时会省略。</FieldDescription>
          </Field>
        </FieldGroup>
      ) : null}
    </div>
  )
}
