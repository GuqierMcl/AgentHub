import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { Switch } from "@/components/animate-ui/components/radix/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { settingsApi, type TerminalSettings } from "../api/settings-api"

const defaults: TerminalSettings = {
  fontSize: 13,
  fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
  cursorBlink: true,
  cursorStyle: "bar",
  maxSessions: 3,
  idleTimeoutMs: 300000,
  replayBufferBytes: 4194304,
  bashDefaultTimeoutMs: 30000,
  bashMaxOutputBytes: 131072,
  reconnectMaxAttempts: 3,
  reconnectDelaysMs: [1000, 2000, 3000],
}

export function TerminalSettingsContent() {
  const [config, setConfig] = useState<TerminalSettings>(defaults)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    settingsApi.fetchTerminal()
      .then((data) => { if (!cancelled) setConfig({ ...defaults, ...data }) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const handleUpdate = useCallback(async <K extends keyof TerminalSettings>(key: K, value: TerminalSettings[K]) => {
    setSaving(key)
    const prev = config
    setConfig((prev) => ({ ...prev, [key]: value }))
    try {
      await settingsApi.updateTerminal({ [key]: value })
    } catch (err) {
      setConfig(prev)
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(null)
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
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-muted-foreground">显示</h4>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">字体大小</div>
          </div>
          <Select
            value={String(config.fontSize)}
            onValueChange={(v) => handleUpdate("fontSize", Number(v))}
            disabled={saving === "fontSize"}
          >
            <SelectTrigger className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[11, 12, 13, 14, 15, 16, 18, 20].map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">字体</div>
          </div>
          <Input
            className="w-60"
            value={config.fontFamily}
            onChange={(e) => handleUpdate("fontFamily", e.target.value)}
            disabled={saving === "fontFamily"}
          />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">光标闪烁</div>
          </div>
          <Switch
            checked={config.cursorBlink}
            onCheckedChange={(checked) => handleUpdate("cursorBlink", checked)}
            disabled={saving === "cursorBlink"}
          />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">光标样式</div>
          </div>
          <Select
            value={config.cursorStyle}
            onValueChange={(v) => handleUpdate("cursorStyle", v as TerminalSettings["cursorStyle"])}
            disabled={saving === "cursorStyle"}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="block">方块</SelectItem>
              <SelectItem value="underline">下划线</SelectItem>
              <SelectItem value="bar">竖线</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-muted-foreground">会话管理</h4>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">最大并发终端数</div>
            <div className="text-xs text-muted-foreground">每个会话可同时开启的终端数量</div>
          </div>
          <Input
            type="number"
            className="w-24"
            value={config.maxSessions}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!isNaN(v) && v >= 1 && v <= 20) handleUpdate("maxSessions", v)
            }}
            disabled={saving === "maxSessions"}
          />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">空闲超时 (秒)</div>
            <div className="text-xs text-muted-foreground">超过此时长无活动自动关闭</div>
          </div>
          <Input
            type="number"
            className="w-24"
            value={Math.round(config.idleTimeoutMs / 1000)}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!isNaN(v) && v >= 30) handleUpdate("idleTimeoutMs", Math.min(v * 1000, 3600000))
            }}
            disabled={saving === "idleTimeoutMs"}
          />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">回放缓冲区 (MB)</div>
            <div className="text-xs text-muted-foreground">终端滚动历史记录大小</div>
          </div>
          <Input
            type="number"
            className="w-24"
            value={Math.round(config.replayBufferBytes / 1048576)}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!isNaN(v) && v >= 1) handleUpdate("replayBufferBytes", Math.min(v * 1048576, 52428800))
            }}
            disabled={saving === "replayBufferBytes"}
          />
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-muted-foreground">命令执行限制</h4>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">Bash 默认超时 (秒)</div>
            <div className="text-xs text-muted-foreground">单条命令最大执行时间</div>
          </div>
          <Input
            type="number"
            className="w-24"
            value={Math.round(config.bashDefaultTimeoutMs / 1000)}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!isNaN(v) && v >= 5) handleUpdate("bashDefaultTimeoutMs", Math.min(v * 1000, 300000))
            }}
            disabled={saving === "bashDefaultTimeoutMs"}
          />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">Bash 最大输出 (KB)</div>
            <div className="text-xs text-muted-foreground">单条命令输出上限</div>
          </div>
          <Input
            type="number"
            className="w-24"
            value={Math.round(config.bashMaxOutputBytes / 1024)}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!isNaN(v) && v >= 10) handleUpdate("bashMaxOutputBytes", Math.min(v * 1024, 10485760))
            }}
            disabled={saving === "bashMaxOutputBytes"}
          />
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-muted-foreground">连接</h4>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">最大重连次数</div>
            <div className="text-xs text-muted-foreground">WebSocket 断线重连上限</div>
          </div>
          <Input
            type="number"
            className="w-24"
            value={config.reconnectMaxAttempts}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!isNaN(v) && v >= 0 && v <= 10) handleUpdate("reconnectMaxAttempts", v)
            }}
            disabled={saving === "reconnectMaxAttempts"}
          />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">重连间隔 (秒)</div>
            <div className="text-xs text-muted-foreground">逗号分隔，如 1,2,3</div>
          </div>
          <Input
            className="w-32"
            value={config.reconnectDelaysMs.map((d) => d / 1000).join(",")}
            onChange={(e) => {
              const parts = e.target.value.split(",").map((s) => Number(s.trim()) * 1000)
              if (parts.every((v) => !isNaN(v) && v > 0)) {
                handleUpdate("reconnectDelaysMs", parts)
              }
            }}
            disabled={saving === "reconnectDelaysMs"}
          />
        </div>
      </div>
    </div>
  )
}
