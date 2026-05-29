import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { Switch } from "@/components/animate-ui/components/radix/switch"

type DiagnosticsConfig = {
  includeModelStream: boolean
  includeReasoning: boolean
  includeRawModelChunks: boolean
}

const defaults: DiagnosticsConfig = {
  includeModelStream: true,
  includeReasoning: true,
  includeRawModelChunks: false,
}

async function fetchDiagnostics(): Promise<DiagnosticsConfig> {
  const res = await fetch("/api/settings/diagnostics")
  if (!res.ok) return { ...defaults }
  return res.json()
}

async function updateDiagnostics(data: Partial<DiagnosticsConfig>): Promise<DiagnosticsConfig> {
  const res = await fetch("/api/settings/diagnostics", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error("更新失败")
  return res.json()
}

export function DiagnosticsContent() {
  const [config, setConfig] = useState<DiagnosticsConfig>(defaults)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchDiagnostics().then((data) => {
        setConfig(data)
        setLoading(false)
      }).catch(() => {
        setLoading(false)
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const handleToggle = useCallback(async (key: keyof DiagnosticsConfig, value: boolean) => {
    setToggling(key)
    const prev = config
    setConfig((prev) => ({ ...prev, [key]: value }))
    try {
      await updateDiagnostics({ [key]: value })
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
