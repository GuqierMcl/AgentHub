import { useMemo, useState } from "react"
import {
  CheckCircle2Icon,
  CopyIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PlugZapIcon,
  RocketIcon,
  ServerIcon,
  XCircleIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { useTabStore } from "@/store/tab-store"

import { deploymentPreviewApi } from "../../api/messages"
import { useWorkbenchStore } from "../../store/workbench-store"
import type {
  DeploymentCommandSnapshot,
  DeploymentConnectionStatus,
  DeploymentSnapshot,
} from "../../types"

const terminalStatusLabel: Record<DeploymentSnapshot["status"], string> = {
  running: "running",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
}

const connectionStatusLabel: Record<DeploymentConnectionStatus, string> = {
  connecting: "connecting",
  connected: "connected",
  disconnecting: "disconnecting",
  disconnected: "disconnected",
  failed: "failed",
  stale: "stale",
}

function getProgressValue(snapshot: DeploymentSnapshot | null): number {
  if (!snapshot) return 0
  if (snapshot.status === "completed") return 100
  if (snapshot.status === "failed" || snapshot.status === "cancelled") {
    return snapshot.progress?.percent ?? 0
  }
  return snapshot.progress?.percent ?? 0
}

function canDisconnect(status: DeploymentConnectionStatus | undefined): boolean {
  return status === "connected" || status === "connecting"
}

function getCommandIcon(command: DeploymentCommandSnapshot) {
  if (command.status === "completed") return <CheckCircle2Icon className="size-3.5 text-emerald-500" />
  if (command.status === "failed") return <XCircleIcon className="size-3.5 text-destructive" />
  return <Loader2Icon className="size-3.5 animate-spin text-primary" />
}

async function copyText(value: string | undefined, label: string): Promise<void> {
  if (!value) return
  await navigator.clipboard.writeText(value)
  toast.success(`${label}已复制`)
}

type DeployPreviewPanelContentProps = {
  snapshot: DeploymentSnapshot | null
  progressValue?: number
  logText?: string
  disconnecting: boolean
  onOpenPreview: () => void
  onDisconnect: () => void
}

export function DeployPreviewPanel() {
  const activeConversationId = useWorkbenchStore((state) => state.activeConversationId)
  const snapshot = useWorkbenchStore((state) =>
    activeConversationId
      ? state.conversations[activeConversationId]?.deploymentSnapshot ?? null
      : null
  )
  const openTab = useTabStore((state) => state.openTab)
  const [disconnecting, setDisconnecting] = useState(false)

  const progressValue = getProgressValue(snapshot)
  const logText = useMemo(
    () => snapshot?.logs.map((entry) => {
      const prefix = entry.stream === "stderr" ? "err" : entry.stream === "stdout" ? "out" : "sys"
      return `[${new Date(entry.timestamp).toLocaleTimeString()}] ${prefix} ${entry.text.replace(/\n$/, "")}`
    }).join("\n") ?? "",
    [snapshot?.logs]
  )

  const handleOpenPreview = () => {
    if (!snapshot?.deploymentUrl) return
    openTab("preview", snapshot.preview?.label ?? "部署预览", {
      source: "deploy",
      initialUrl: snapshot.deploymentUrl,
    })
  }

  const handleDisconnect = async () => {
    if (!snapshot?.connectionId || !canDisconnect(snapshot.connectionStatus)) return
    setDisconnecting(true)
    try {
      await deploymentPreviewApi.disconnectConnection(snapshot.connectionId)
      toast.success("部署连接已断开")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "断开部署连接失败")
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <DeployPreviewPanelContent
      disconnecting={disconnecting}
      logText={logText}
      onDisconnect={() => void handleDisconnect()}
      onOpenPreview={handleOpenPreview}
      progressValue={progressValue}
      snapshot={snapshot}
    />
  )
}

export function DeployPreviewPanelContent({
  snapshot,
  progressValue = getProgressValue(snapshot),
  logText = snapshot?.logs.map((entry) => {
    const prefix = entry.stream === "stderr" ? "err" : entry.stream === "stdout" ? "out" : "sys"
    return `[${new Date(entry.timestamp).toLocaleTimeString()}] ${prefix} ${entry.text.replace(/\n$/, "")}`
  }).join("\n") ?? "",
  disconnecting,
  onOpenPreview,
  onDisconnect,
}: DeployPreviewPanelContentProps) {
  if (!snapshot) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background">
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <div className="min-w-0 max-w-full">
            <div className="mx-auto flex size-11 items-center justify-center rounded-md bg-primary/10 text-primary">
              <RocketIcon className="size-5" />
            </div>
            <h3 className="mt-3 font-medium text-sm">等待部署任务</h3>
            <p className="mt-1 text-muted-foreground text-xs">
              Deploy 智能体开始后会显示服务器、进度和远程日志。
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="min-h-0 min-w-0 w-full max-w-full flex-1 overflow-x-hidden overflow-y-auto">
        <div className="flex w-full min-w-0 max-w-full flex-col gap-4 p-4">
          <section className="w-full min-w-0 max-w-full overflow-hidden rounded-md border bg-background">
            <div className="flex w-full min-w-0 max-w-full items-center justify-between gap-3 overflow-hidden border-border border-b px-3 py-2">
              <div className="flex min-w-0 max-w-full flex-1 items-center gap-2 overflow-hidden">
                <ServerIcon className="size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1 overflow-hidden">
                  <h3 className="max-w-full truncate font-medium text-sm">
                    {snapshot.title ?? "Deployment"}
                  </h3>
                  <p className="max-w-full truncate text-muted-foreground text-xs">
                    {snapshot.server?.displayName ?? "未选择服务器"}
                    {snapshot.server?.hostLabel ? ` · ${snapshot.server.hostLabel}` : ""}
                  </p>
                </div>
              </div>
              <Badge
                className="shrink-0"
                variant={snapshot.status === "failed" ? "destructive" : "secondary"}
              >
                {terminalStatusLabel[snapshot.status]}
              </Badge>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-3 p-3 text-xs sm:grid-cols-2">
              <div className="min-w-0">
                <div className="text-muted-foreground">连接</div>
                <div className="mt-1 break-words font-medium">
                  {snapshot.connectionStatus
                    ? connectionStatusLabel[snapshot.connectionStatus]
                    : "unknown"}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-muted-foreground">健康检查</div>
                <div className="mt-1 break-words font-medium">
                  {snapshot.health
                    ? snapshot.health.ok
                      ? `OK ${snapshot.health.status ?? ""}`.trim()
                      : snapshot.health.error ?? `HTTP ${snapshot.health.status ?? "failed"}`
                    : "未检查"}
                </div>
              </div>
            </div>
          </section>

          <section className="flex min-w-0 max-w-full flex-col gap-2 rounded-md border bg-background p-3">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <h3 className="min-w-0 truncate font-medium text-sm">发布进度</h3>
              <Badge className="shrink-0" variant="outline">{Math.round(progressValue)}%</Badge>
            </div>
            <Progress value={progressValue} />
            <p className="break-words text-muted-foreground text-xs">
              {snapshot.progress?.message ?? snapshot.summary ?? "部署任务正在准备。"}
            </p>
            {snapshot.progress?.totalSteps ? (
              <div className="break-words text-muted-foreground text-xs">
                Step {snapshot.progress.currentStep ?? "-"} / {snapshot.progress.totalSteps}
                {snapshot.progress.stepTitle ? ` · ${snapshot.progress.stepTitle}` : ""}
              </div>
            ) : null}
          </section>

          <section className="flex min-w-0 max-w-full flex-col gap-2">
            <h3 className="font-medium text-sm">远程命令</h3>
            <div className="min-w-0 divide-y overflow-hidden rounded-md border">
              {snapshot.commands.length ? snapshot.commands.map((command) => (
                <div className="flex min-w-0 items-start gap-2 px-3 py-2" key={command.commandId}>
                  <span className="mt-0.5 shrink-0">{getCommandIcon(command)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="max-w-full overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                      {command.command ?? command.commandId}
                    </div>
                    <div className="mt-1 break-words text-muted-foreground text-xs">
                      {command.status}
                      {typeof command.exitCode === "number" ? ` · exit ${command.exitCode}` : ""}
                      {typeof command.durationMs === "number" ? ` · ${command.durationMs}ms` : ""}
                    </div>
                  </div>
                </div>
              )) : (
                <div className="px-3 py-3 text-muted-foreground text-xs">暂无远程命令</div>
              )}
            </div>
          </section>

          <section className="flex min-h-40 min-w-0 max-w-full flex-col gap-2">
            <h3 className="font-medium text-sm">部署日志</h3>
            <pre className="min-h-36 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md border bg-zinc-950 p-3 text-zinc-100 text-xs leading-6">
              {logText || "暂无部署日志"}
            </pre>
          </section>

          <section className="flex min-w-0 max-w-full flex-col gap-2">
            <h3 className="font-medium text-sm">发布说明</h3>
            <Textarea
              className="min-h-24 max-w-full resize-none break-words text-xs"
              readOnly
              value={snapshot.releaseNote ?? ""}
            />
          </section>
        </div>
      </div>

      <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2 border-border border-t p-3">
        <Button
          disabled={!snapshot.releaseNote}
          onClick={() => void copyText(snapshot.releaseNote, "发布说明")}
          size="sm"
          type="button"
          variant="outline"
        >
          <CopyIcon />
          说明
        </Button>
        <Button
          disabled={!snapshot.deploymentUrl}
          onClick={() => void copyText(snapshot.deploymentUrl, "部署链接")}
          size="sm"
          type="button"
          variant="outline"
        >
          <CopyIcon />
          链接
        </Button>
        <Button
          disabled={!snapshot.deploymentUrl}
          onClick={onOpenPreview}
          size="sm"
          type="button"
          variant="outline"
        >
          <ExternalLinkIcon />
          打开
        </Button>
        <Button
          disabled={disconnecting || !snapshot.connectionId || !canDisconnect(snapshot.connectionStatus)}
          onClick={onDisconnect}
          size="sm"
          type="button"
          variant="destructive"
        >
          <PlugZapIcon />
          断开
        </Button>
      </div>
    </div>
  )
}
