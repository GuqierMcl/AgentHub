import { useEffect, useRef } from "react"
import { Loader2Icon, PlugIcon, RefreshCwIcon, TimerOffIcon, AlertCircleIcon } from "lucide-react"

import type { TerminalTabPayload } from "@/store/tab-store"
import { useTabStore } from "@/store/tab-store"
import { cn } from "@/lib/utils"

import { XTermView, type XTermViewHandle } from "../../terminal/components/XTermView"
import { useTerminalSession } from "../../terminal/use-terminal-session"
import type { TerminalViewStatus } from "../../terminal/types"

type TerminalPanelProps = {
  uid: string
  title: string
  payload?: TerminalTabPayload
}

const statusConfig: Record<TerminalViewStatus, { label: string; icon: typeof Loader2Icon; color: string }> = {
  idle: { label: "", icon: PlugIcon, color: "text-muted-foreground" },
  creating: { label: "创建会话中...", icon: Loader2Icon, color: "text-muted-foreground" },
  connecting: { label: "连接中...", icon: Loader2Icon, color: "text-blue-500" },
  connected: { label: "已连接", icon: PlugIcon, color: "text-green-500" },
  reconnecting: { label: "断线重连...", icon: RefreshCwIcon, color: "text-amber-500" },
  expired: { label: "会话已过期", icon: TimerOffIcon, color: "text-muted-foreground" },
  error: { label: "连接失败", icon: AlertCircleIcon, color: "text-red-500" },
}

function StatusOverlay({
  status,
  errorMessage,
  onRetry,
}: {
  status: TerminalViewStatus
  errorMessage?: string
  onRetry?: () => void
}) {
  if (status === "connected" || status === "idle") return null

  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/80">
      <div className="pointer-events-auto flex flex-col items-center gap-2 text-center">
        <Icon
          className={cn(
            "size-6",
            config.color,
            (status === "creating" || status === "connecting" || status === "reconnecting") && "animate-spin"
          )}
        />
        <span className={cn("text-sm", config.color)}>{config.label}</span>
        {errorMessage && (
          <span className="max-w-xs text-muted-foreground text-xs">{errorMessage}</span>
        )}
        {(status === "expired" || status === "error") && onRetry && (
          <button
            className="mt-1 cursor-pointer rounded px-3 py-1 text-xs text-foreground hover:bg-muted"
            onClick={onRetry}
            type="button"
          >
            重新打开
          </button>
        )}
      </div>
    </div>
  )
}

export function TerminalPanel({ uid, title, payload }: TerminalPanelProps) {
  const xtermRef = useRef<XTermViewHandle>(null)
  const updateTabPayload = useTabStore((s) => s.updateTabPayload)

  const {
    status,
    sessionId,
    errorMessage,
    open: openSession,
    disconnect,
    recreate,
    sendInput,
    sendResize,
    onOutput,
    onReplay,
  } = useTerminalSession({
    payload: payload ?? {
      conversationId: "",
      workspaceId: "",
      workspaceLabel: "unknown",
    },
  })

  const hasOpened = useRef(false)

  useEffect(() => {
    if (!payload || hasOpened.current) return
    hasOpened.current = true
    void openSession()
  }, [payload, openSession])

  useEffect(() => {
    return () => {
      disconnect()
      hasOpened.current = false
    }
  }, [disconnect])

  useEffect(() => {
    if (!payload || !sessionId || payload.sessionId === sessionId) return

    updateTabPayload(uid, {
      ...payload,
      sessionId,
    })
  }, [payload, sessionId, uid, updateTabPayload])

  useEffect(() => {
    onOutput((data) => {
      xtermRef.current?.write(data)
    })
  }, [onOutput])

  useEffect(() => {
    onReplay((chunks) => {
      for (const chunk of chunks) {
        xtermRef.current?.write(chunk)
      }
    })
  }, [onReplay])

  const handleData = (data: string) => {
    sendInput(data)
  }

  const handleResize = (cols: number, rows: number) => {
    sendResize(cols, rows)
  }

  const handleRetry = () => {
    void recreate()
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center gap-2 border-border border-b px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-sm">{title}</div>
          {payload?.workspaceLabel && (
            <div className="truncate text-muted-foreground text-xs">
              {payload.workspaceLabel}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {status !== "idle" && status !== "connected" && (
            <StatusBadge status={status} />
          )}
        </div>
      </div>

      <div className="relative min-h-0 min-w-0 w-full flex-1 overflow-hidden bg-[#0b0f14]">
        <StatusOverlay
          errorMessage={errorMessage}
          status={status}
          onRetry={handleRetry}
        />
        <XTermView
          ref={xtermRef}
          className={cn(
            "h-full min-h-0 min-w-0 w-full",
            (status !== "connected" && status !== "idle") && "opacity-30"
          )}
          onData={handleData}
          onResize={handleResize}
        />
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: TerminalViewStatus }) {
  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
        config.color,
        "bg-muted"
      )}
    >
      <Icon
        className={cn(
          "size-3",
          (status === "creating" || status === "connecting" || status === "reconnecting") && "animate-spin"
        )}
      />
      {config.label}
    </span>
  )
}
