import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { Switch } from "@/components/animate-ui/components/radix/switch"
import { settingsApi, type DiagnosticsSettings } from "../api/settings-api"

const defaults: DiagnosticsSettings = {
  includeModelStream: true,
  includeReasoning: true,
  includeRawModelChunks: false,
}

export function DiagnosticsContent() {
  const [config, setConfig] = useState<DiagnosticsSettings>(defaults)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    settingsApi.fetchDiagnostics()
      .then((data) => { if (!cancelled) setConfig({ ...defaults, ...data }) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const handleToggle = useCallback(async (key: keyof DiagnosticsSettings, value: boolean) => {
    setToggling(key)
    const prev = config
    setConfig((prev) => ({ ...prev, [key]: value }))
    try {
      await settingsApi.updateDiagnostics({ [key]: value })
    } catch (err) {
      setConfig(prev)
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setToggling(null)
    }
  }, [config])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        加载中...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">包含模型流追踪</div>
            <div className="text-xs text-muted-foreground">
              输出 model.stream.part 事件，用于前端调试
            </div>
          </div>
          <Switch
            checked={config.includeModelStream}
            onCheckedChange={(checked) => handleToggle("includeModelStream", checked)}
            disabled={toggling === "includeModelStream"}
          />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">包含推理过程</div>
            <div className="text-xs text-muted-foreground">
              输出 reasoning.* 事件，展示 AI 推理内容
            </div>
          </div>
          <Switch
            checked={config.includeReasoning}
            onCheckedChange={(checked) => handleToggle("includeReasoning", checked)}
            disabled={toggling === "includeReasoning"}
          />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">包含原始模型块</div>
            <div className="text-xs text-muted-foreground">
              不过滤 AI SDK raw chunk，用于深度调试
            </div>
          </div>
          <Switch
            checked={config.includeRawModelChunks}
            onCheckedChange={(checked) => handleToggle("includeRawModelChunks", checked)}
            disabled={toggling === "includeRawModelChunks"}
          />
        </div>
      </div>
    </div>
  )
}
