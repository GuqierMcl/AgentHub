import { useEffect, useState, useCallback } from "react"
import { cn } from "@/lib/utils"

type HealthResponse = {
  status: string
  timestamp: string
  uptime: number
}

type RuntimeInfoResponse = {
  mode: string
  runtime: {
    url: string
    port: number
  }
}

const POLL_INTERVAL = 5000

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  const hours = String(d.getHours()).padStart(2, "0")
  const minutes = String(d.getMinutes()).padStart(2, "0")
  const seconds = String(d.getSeconds()).padStart(2, "0")
  return `${year}年${month}月${day}日 ${hours}:${minutes}:${seconds}`
}

type SettingsItemProps = {
  label: string
  description?: string
  className?: string
  children: React.ReactNode
}

function SettingsItem({ label, description, className, children }: SettingsItemProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4 py-3", className)}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
        )}
      </div>
      <div className="shrink-0 text-sm">{children}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const isHealthy = status === "ok"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        isHealthy
          ? "bg-green-500/10 text-green-700 dark:text-green-400"
          : "bg-red-500/10 text-red-700 dark:text-red-400"
      )}
    >
      {isHealthy ? "健康" : "不健康"}
    </span>
  )
}

export function RuntimeContent() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfoResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchRuntimeInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/runtime/info")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: RuntimeInfoResponse = await res.json()
      setRuntimeInfo(data)
    } catch {
      // runtime info fetch failure is non-critical
    }
  }, [])

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/runtime/health")
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data: HealthResponse = await res.json()
      setHealth(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "连接失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHealth()
    fetchRuntimeInfo()
    const timer = setInterval(fetchHealth, POLL_INTERVAL)
    return () => clearInterval(timer)
  }, [fetchHealth, fetchRuntimeInfo])

  const port = runtimeInfo?.runtime.port ?? "-"
  const mode = runtimeInfo?.mode ?? "-"

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-base font-semibold">运行状态</h3>
        <div className="rounded-xl bg-muted/30 px-4">
          <SettingsItem
            label="健康状态"
            description="Agent Runtime 最近一次健康检查结果"
            className="border-b border-border/50"
          >
            {loading ? (
              <span className="text-muted-foreground">检查中...</span>
            ) : health ? (
              <StatusBadge status={health.status} />
            ) : (
              <StatusBadge status="error" />
            )}
          </SettingsItem>
          <SettingsItem label="最近检查" description="最后一次健康检查完成时间">
            {health?.timestamp ? (
              <span>{formatTimestamp(health.timestamp)}</span>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </SettingsItem>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold">连接信息</h3>
        <div className="rounded-xl bg-muted/30 px-4">
          <SettingsItem
            label="Endpoint"
            description="本机 Agent Runtime 端口"
            className="border-b border-border/50"
          >
            <span>{port}</span>
          </SettingsItem>
          <SettingsItem label="运行模式" description="由后端解析得到">
            <span>{mode}</span>
          </SettingsItem>
        </div>
      </div>

      {error && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">错误信息</h3>
          <div className="rounded-xl bg-muted/30 px-4 py-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </div>
      )}
    </div>
  )
}