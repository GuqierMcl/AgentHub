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
import { settingsApi, type EditorSettings } from "../api/settings-api"

const defaults: EditorSettings = {
  fontSize: 14,
  fontFamily: "",
  tabSize: 2,
  wordWrap: "off",
  lineNumbers: "on",
  minimapEnabled: false,
  folding: true,
  renderWhitespace: "selection",
  codeBlockLineNumbers: false,
  maxPreviewFileSize: 512000,
  maxEditableFileSize: 1048576,
  maxLineCount: 20000,
  maxLineLength: 20000,
}

async function updateField<K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) {
  return settingsApi.updateEditor({ [key]: value })
}

export function EditorSettingsContent() {
  const [config, setConfig] = useState<EditorSettings>(defaults)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    settingsApi.fetchEditor()
      .then((data) => { if (!cancelled) setConfig({ ...defaults, ...data }) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const handleUpdate = useCallback(async <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => {
    setSaving(key)
    const prev = config
    setConfig((prev) => ({ ...prev, [key]: value }))
    try {
      await updateField(key, value)
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
              {[12, 13, 14, 15, 16, 18, 20, 22, 24].map((n) => (
                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">字体</div>
            <div className="text-xs text-muted-foreground">留空使用默认字体</div>
          </div>
          <Input
            className="w-40"
            value={config.fontFamily}
            onChange={(e) => handleUpdate("fontFamily", e.target.value)}
            disabled={saving === "fontFamily"}
            placeholder="默认"
          />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">Tab 缩进</div>
          </div>
          <Select
            value={String(config.tabSize)}
            onValueChange={(v) => handleUpdate("tabSize", Number(v) as 2 | 4 | 8)}
            disabled={saving === "tabSize"}
          >
            <SelectTrigger className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="4">4</SelectItem>
              <SelectItem value="8">8</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">自动换行</div>
          </div>
          <Select
            value={config.wordWrap}
            onValueChange={(v) => handleUpdate("wordWrap", v as EditorSettings["wordWrap"])}
            disabled={saving === "wordWrap"}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">关闭</SelectItem>
              <SelectItem value="on">开启</SelectItem>
              <SelectItem value="wordWrapColumn">按列宽</SelectItem>
              <SelectItem value="bounded">窗口边界</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">显示行号</div>
          </div>
          <Select
            value={config.lineNumbers}
            onValueChange={(v) => handleUpdate("lineNumbers", v as EditorSettings["lineNumbers"])}
            disabled={saving === "lineNumbers"}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="on">显示</SelectItem>
              <SelectItem value="off">隐藏</SelectItem>
              <SelectItem value="relative">相对行号</SelectItem>
              <SelectItem value="interval">间隔显示</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">显示小地图</div>
            <div className="text-xs text-muted-foreground">代码概览缩略图</div>
          </div>
          <Switch
            checked={config.minimapEnabled}
            onCheckedChange={(checked) => handleUpdate("minimapEnabled", checked)}
            disabled={saving === "minimapEnabled"}
          />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">代码折叠</div>
          </div>
          <Switch
            checked={config.folding}
            onCheckedChange={(checked) => handleUpdate("folding", checked)}
            disabled={saving === "folding"}
          />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">显示空白字符</div>
          </div>
          <Select
            value={config.renderWhitespace}
            onValueChange={(v) => handleUpdate("renderWhitespace", v as EditorSettings["renderWhitespace"])}
            disabled={saving === "renderWhitespace"}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不显示</SelectItem>
              <SelectItem value="boundary">边界</SelectItem>
              <SelectItem value="selection">选中时</SelectItem>
              <SelectItem value="trailing">尾部</SelectItem>
              <SelectItem value="all">全部显示</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">代码块显示行号</div>
            <div className="text-xs text-muted-foreground">聊天消息中的代码块</div>
          </div>
          <Switch
            checked={config.codeBlockLineNumbers}
            onCheckedChange={(checked) => handleUpdate("codeBlockLineNumbers", checked)}
            disabled={saving === "codeBlockLineNumbers"}
          />
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-muted-foreground">限制</h4>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">代码预览最大文件 (KB)</div>
            <div className="text-xs text-muted-foreground">超过此值用纯文本显示</div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              className="w-24"
              value={Math.round(config.maxPreviewFileSize / 1024)}
              onChange={(e) => {
                const kb = Number(e.target.value)
                if (!isNaN(kb) && kb > 0) handleUpdate("maxPreviewFileSize", Math.min(kb * 1024, 52428800))
              }}
              disabled={saving === "maxPreviewFileSize"}
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">可编辑文件最大 (MB)</div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              className="w-24"
              value={Math.round(config.maxEditableFileSize / 1048576 * 10) / 10}
              onChange={(e) => {
                const mb = Number(e.target.value)
                if (!isNaN(mb) && mb > 0) handleUpdate("maxEditableFileSize", Math.min(mb * 1048576, 52428800))
              }}
              disabled={saving === "maxEditableFileSize"}
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">最大预览行数</div>
          </div>
          <Input
            type="number"
            className="w-24"
            value={config.maxLineCount}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!isNaN(v) && v > 0) handleUpdate("maxLineCount", v)
            }}
            disabled={saving === "maxLineCount"}
          />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="space-y-0.5">
            <div className="text-sm font-medium">最大行长度</div>
          </div>
          <Input
            type="number"
            className="w-24"
            value={config.maxLineLength}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!isNaN(v) && v > 0) handleUpdate("maxLineLength", v)
            }}
            disabled={saving === "maxLineLength"}
          />
        </div>
      </div>
    </div>
  )
}
