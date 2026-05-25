import { useState, useCallback, useEffect } from "react"
import { EyeIcon, EyeOffIcon, PlusIcon, TrashIcon } from "lucide-react"

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
import { runtimeApi } from "../../api/runtime"
import type { ProviderSummary, ModelResponse } from "../../types"

type ModelEntry = {
  id: string
  name: string
}

type ConnectProviderDialogProps = {
  provider: ProviderSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConnected: () => void
}

export function ConnectProviderDialog({
  provider,
  open,
  onOpenChange,
  onConnected,
}: ConnectProviderDialogProps) {
  const isConnected = provider?.has_api_key ?? false
  const isCustom = provider?.source === "custom"

  const [name, setName] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [apiBase, setApiBase] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<ModelEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && provider) {
      setApiKey("")
      setApiBase(provider.api_base || "")
      setName(provider.name)
      setModels([])
      setError(null)
      setShowKey(false)

      if (isConnected) {
        setLoadingDetail(true)
        runtimeApi
          .getProvider(provider.id)
          .then((detail) => {
            setApiKey(detail.api_key || "")
            if (isCustom) {
              setName(detail.name)
              setApiBase(detail.api_base || "")
              const modelList: ModelEntry[] = Object.values(detail.models).map(
                (m: ModelResponse) => ({
                  id: m.id,
                  name: m.name,
                })
              )
              setModels(modelList)
            }
          })
          .catch(() => {})
          .finally(() => {
            setLoadingDetail(false)
          })
      }
    }
  }, [open, provider, isConnected, isCustom])

  const addModel = useCallback(() => {
    setModels((prev) => [...prev, { id: "", name: "" }])
  }, [])

  const removeModel = useCallback((index: number) => {
    setModels((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const updateModel = useCallback(
    (index: number, field: "id" | "name", value: string) => {
      setModels((prev) =>
        prev.map((m, i) => (i === index ? { ...m, [field]: value } : m))
      )
    },
    []
  )

  const handleSubmit = useCallback(async () => {
    if (!provider) return

    setSaving(true)
    setError(null)
    try {
      if (isCustom) {
        const modelsObj: Record<string, { name?: string; upstream_id?: string }> = {}
        for (const m of models) {
          if (m.id) {
            modelsObj[m.id] = {
              name: m.name || undefined,
              upstream_id: m.id,
            }
          }
        }

        await runtimeApi.updateCustomProvider(provider.id, {
          name,
          api_base: apiBase,
          api_key: apiKey || undefined,
          models: Object.keys(modelsObj).length > 0 ? modelsObj : undefined,
        })
      } else {
        await runtimeApi.updateProviderConfig(provider.id, {
          api_key: apiKey || undefined,
          enabled: true,
        })
      }
      setApiKey("")
      onConnected()
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }, [provider, isCustom, name, apiBase, apiKey, models, onConnected])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent from="top" className="w-[540px] p-6">
        {provider && (
          <>
            <DialogHeader>
              <DialogTitle>
                {isConnected ? "编辑" : "连接"} {provider.name}
              </DialogTitle>
              <DialogDescription>
                {isCustom
                  ? "编辑自定义供应商的配置信息，并保存到 Agent Runtime 本地配置。"
                  : "API 密钥和 API Base 只会保存到 Agent Runtime 的本地配置中。"}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {isCustom && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">供应商名称</label>
                    <Input
                      placeholder="例如 My Gateway"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Provider ID</label>
                    <Input value={provider.id} disabled />
                    <p className="text-xs text-muted-foreground">
                      Provider ID 不可修改。
                    </p>
                  </div>
                </>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">API Base</label>
                <Input
                  placeholder="https://api.example.com/v1"
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  disabled={!isCustom}
                />
                {!isCustom && (
                  <p className="text-xs text-muted-foreground">
                    预设供应商的 API Base 不可修改
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">API 密钥</label>
                <div className="relative">
                  <Input
                    type={showKey ? "text" : "password"}
                    placeholder={loadingDetail ? "加载中..." : "输入 API 密钥"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    disabled={loadingDetail}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowKey(!showKey)}
                  >
                    {showKey ? (
                      <EyeOffIcon className="size-4" />
                    ) : (
                      <EyeIcon className="size-4" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  可以点击右侧按钮查看或隐藏明文。
                </p>
              </div>

              {isCustom && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">模型</label>
                  <div className="space-y-2">
                    {models.map((m, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          placeholder="model-id"
                          value={m.id}
                          onChange={(e) => updateModel(i, "id", e.target.value)}
                          className="flex-1"
                        />
                        <Input
                          placeholder="显示名称"
                          value={m.name}
                          onChange={(e) => updateModel(i, "name", e.target.value)}
                          className="flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeModel(i)}
                        >
                          <TrashIcon className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" onClick={addModel}>
                    <PlusIcon />
                    添加模型
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    显示名称可留空，留空时会使用模型 ID。
                  </p>
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button onClick={handleSubmit} disabled={saving || loadingDetail}>
                {saving ? "保存中..." : isConnected ? "更新" : "连接"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}