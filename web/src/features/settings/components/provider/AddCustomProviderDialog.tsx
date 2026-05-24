import { useState, useCallback } from "react"
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

type ModelEntry = {
  id: string
  name: string
}

type AddCustomProviderDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function AddCustomProviderDialog({
  open,
  onOpenChange,
  onCreated,
}: AddCustomProviderDialogProps) {
  const [name, setName] = useState("")
  const [providerId, setProviderId] = useState("")
  const [apiBase, setApiBase] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<ModelEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    if (!name || !providerId || !apiBase) {
      setError("请填写必填字段")
      return
    }

    setSaving(true)
    setError(null)
    try {
      const modelsObj: Record<string, { name?: string; upstream_id?: string }> = {}
      for (const m of models) {
        if (m.id) {
          modelsObj[m.id] = {
            name: m.name || undefined,
            upstream_id: m.id,
          }
        }
      }

      await runtimeApi.createCustomProvider({
        id: providerId,
        name,
        api_base: apiBase,
        api_key: apiKey || undefined,
        models: Object.keys(modelsObj).length > 0 ? modelsObj : undefined,
      })

      setName("")
      setProviderId("")
      setApiBase("")
      setApiKey("")
      setModels([])
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败")
    } finally {
      setSaving(false)
    }
  }, [name, providerId, apiBase, apiKey, models, onCreated])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent from="top" className="w-[540px] p-6">
        <DialogHeader>
          <DialogTitle>连接自定义供应商</DialogTitle>
          <DialogDescription>
            添加与 OpenAI API 兼容的供应商，并保存到 AI Engine 本地配置。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
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
            <Input
              placeholder="例如 my-gateway"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              用于配置存储和接口路径，建议使用小写字母、数字和连字符。
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">API Base</label>
            <Input
              placeholder="https://api.example.com/v1"
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">API 密钥</label>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                placeholder="输入 API 密钥"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </button>
            </div>
          </div>

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

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "连接中..." : "连接"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}