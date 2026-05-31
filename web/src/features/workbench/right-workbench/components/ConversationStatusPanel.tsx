import {
  GitBranchIcon,
  ListChecksIcon,
  NetworkIcon,
  SigmaIcon,
  TimerIcon,
} from "lucide-react"
import type { ReactNode } from "react"

import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from "@/components/ai-elements/queue"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import type { RuntimeRunStatus } from "@/features/workbench/api/runtime-runs"
import type { RunConnectionStatus } from "@/features/workbench/store/workbench-store"
import type {
  Conversation,
  WorkbenchTimelinePlanItem,
} from "@/features/workbench/types"
import { cn } from "@/lib/utils"

type ConversationStatusPanelProps = {
  conversation: Conversation | null
  connectionStatus: RunConnectionStatus
  runStatus: RuntimeRunStatus | "idle" | "submitted"
}

export function ConversationStatusPanel({
  conversation,
  connectionStatus,
  runStatus,
}: ConversationStatusPanelProps) {
  const latestPlan = conversation?.timelineItems.findLast(
    (item): item is WorkbenchTimelinePlanItem => item.kind === "plan"
  )
  const chatMessageCount =
    conversation?.timelineItems.filter((item) => item.kind === "chat_message")
      .length ?? 0
  const taskCount = latestPlan?.tasks.length ?? 0
  const completedTaskCount =
    latestPlan?.tasks.filter((task) => task.status === "completed").length ?? 0

  const planAggregateStatus = latestPlan
    ? getPlanAggregateStatus(latestPlan.tasks)
    : null
  const planStatusMeta = planAggregateStatus
    ? getPlanTaskStatusMeta(planAggregateStatus)
    : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-background w-full">
      <div className="shrink-0 border-border border-b p-3">
        <div className="flex items-center gap-2">
          <ListChecksIcon className="size-4 text-primary" />
          <div className="min-w-0">
            <h3 className="truncate font-medium text-sm">会话状态</h3>
            <p className="truncate text-muted-foreground text-xs">
              {conversation?.title ?? "选择会话后查看运行上下文"}
            </p>
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-medium text-sm">执行计划</h4>
              {planStatusMeta ? (
                <Badge className={planStatusMeta.className} variant="outline">
                  {planStatusMeta.label}
                </Badge>
              ) : null}
            </div>
            {latestPlan ? (
              <PlanQueue item={latestPlan} />
            ) : (
              <div className="rounded-md border bg-muted/20 p-3 text-muted-foreground text-sm">
                当前会话暂无执行计划
              </div>
            )}
          </section>

          <Separator />

          <section className="grid grid-cols-2 gap-2">
            <StatusMetric
              icon={<TimerIcon className="size-4" />}
              label="Run 状态"
              value={runStatusLabel(runStatus)}
            />
            <StatusMetric
              icon={<NetworkIcon className="size-4" />}
              label="事件流"
              value={connectionStatusLabel(connectionStatus)}
            />
            <StatusMetric
              icon={<SigmaIcon className="size-4" />}
              label="上下文"
              value={`${chatMessageCount} 条消息`}
            />
            <StatusMetric
              icon={<ListChecksIcon className="size-4" />}
              label="计划进度"
              value={`${completedTaskCount}/${taskCount}`}
            />
          </section>

          <Separator />

          <section className="space-y-2">
            <SectionTitle icon={<GitBranchIcon className="size-4" />}>
              Git 信息
            </SectionTitle>
            <div className="rounded-md border bg-muted/20 p-3 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">当前分支</span>
                <span>未接入</span>
              </div>
              <div className="mt-2 flex justify-between gap-2">
                <span className="text-muted-foreground">工作区状态</span>
                <span>静态占位</span>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <SectionTitle icon={<SigmaIcon className="size-4" />}>
              Token 信息
            </SectionTitle>
            <div className="rounded-md border bg-muted/20 p-3 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">输入 Token</span>
                <span>待统计</span>
              </div>
              <div className="mt-2 flex justify-between gap-2">
                <span className="text-muted-foreground">输出 Token</span>
                <span>待统计</span>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <SectionTitle icon={<NetworkIcon className="size-4" />}>
              工作区
            </SectionTitle>
            <div className="rounded-md border bg-muted/20 p-3 text-muted-foreground text-xs">
              {conversation?.workspace || "当前会话未绑定工作区"}
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}

function PlanQueue({ item }: { item: WorkbenchTimelinePlanItem }) {
  return (
    <Queue>
      <QueueSection defaultOpen>
        <QueueSectionTrigger className="flex flex-col flex-1 items-start gap-1">
   
          <QueueSectionLabel count={item.tasks.length} label="个任务" />
          <span className="min-w-0 truncate pl-2 text-right text-muted-foreground text-xs">
            {item.title}
          </span>
        </QueueSectionTrigger>
        <QueueSectionContent>
          {item.description ? (
            <div className="px-3 pt-2 text-muted-foreground text-xs">
              {item.description}
            </div>
          ) : null}
          {item.tasks.length ? (
            <QueueList>
              {item.tasks.map((task) => {
                const statusMeta = getPlanTaskStatusMeta(task.status)

                return (
                  <QueueItem key={task.taskId}>
                    <span className="flex min-w-0 items-start gap-3">
                      <QueueItemIndicator
                        className={
                          statusMeta.failed
                            ? "border-destructive/50 bg-destructive/10"
                            : undefined
                        }
                        completed={statusMeta.completed}
                      />
                      <QueueItemContent
                        className={statusMeta.failed ? "text-destructive" : undefined}
                        completed={statusMeta.completed}
                      >
                        {task.title}
                      </QueueItemContent>
                      {task.status ? (
                        <Badge
                          className={cn("shrink-0", statusMeta.className)}
                          variant="outline"
                        >
                          {statusMeta.label}
                        </Badge>
                      ) : null}
                    </span>
                    {task.targetAgentId ? (
                      <QueueItemDescription completed={statusMeta.completed}>
                        Target: {task.targetAgentId}
                      </QueueItemDescription>
                    ) : null}
                  </QueueItem>
                )
              })}
            </QueueList>
          ) : (
            <div className="px-3 pt-2 text-muted-foreground text-sm">
              Plan updated.
            </div>
          )}
        </QueueSectionContent>
      </QueueSection>
    </Queue>
  )
}

function getPlanAggregateStatus(tasks: WorkbenchTimelinePlanItem["tasks"]): string | undefined {
  if (tasks.length === 0) return undefined
  const statuses = tasks.map((t) => t.status?.toLowerCase())
  if (statuses.some((s) => s === "failed" || s === "error")) return "failed"
  if (statuses.some((s) => s === "running" || s === "in_progress" || s === "active")) return "running"
  if (statuses.every((s) => s === "completed" || s === "done" || s === "success")) return "completed"
  if (statuses.some((s) => s === "cancelled" || s === "canceled")) return "cancelled"
  return "pending"
}

function getPlanTaskStatusMeta(status?: string) {
  const normalized = status?.trim().toLowerCase()

  switch (normalized) {
    case "completed":
    case "done":
    case "success":
      return {
        label: "已完成",
        completed: true,
        failed: false,
        className:
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
      }
    case "in_progress":
    case "running":
    case "active":
      return {
        label: "进行中",
        completed: false,
        failed: false,
        className:
          "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300",
      }
    case "pending":
    case "todo":
    case "queued":
      return {
        label: "待处理",
        completed: false,
        failed: false,
        className:
          "border-muted-foreground/20 bg-muted/50 text-muted-foreground",
      }
    case "blocked":
      return {
        label: "已阻塞",
        completed: false,
        failed: false,
        className:
          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300",
      }
    case "failed":
    case "error":
      return {
        label: "失败",
        completed: false,
        failed: true,
        className:
          "border-destructive/30 bg-destructive/10 text-destructive",
      }
    case "cancelled":
    case "canceled":
      return {
        label: "已取消",
        completed: false,
        failed: true,
        className:
          "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300",
      }
    case "skipped":
      return {
        label: "已跳过",
        completed: false,
        failed: false,
        className:
          "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-300",
      }
    default:
      return {
        label: status ?? "未知",
        completed: false,
        failed: false,
        className:
          "border-muted-foreground/20 bg-muted/50 text-muted-foreground",
      }
  }
}

function StatusMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className="mt-2 truncate font-medium text-sm">{value}</div>
    </div>
  )
}

function SectionTitle({
  children,
  icon,
}: {
  children: ReactNode
  icon: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      {icon}
      <h4 className="font-medium text-sm text-foreground">{children}</h4>
    </div>
  )
}

function runStatusLabel(status: ConversationStatusPanelProps["runStatus"]) {
  switch (status) {
    case "submitted":
      return "提交中"
    case "queued":
      return "排队中"
    case "running":
      return "运行中"
    case "waiting_approval":
      return "等待审批"
    case "waiting_input":
      return "等待输入"
    case "completed":
      return "已完成"
    case "failed":
      return "失败"
    case "cancelled":
      return "已取消"
    default:
      return "空闲"
  }
}

function connectionStatusLabel(status: RunConnectionStatus) {
  switch (status) {
    case "connecting":
      return "连接中"
    case "connected":
      return "已连接"
    case "disconnected":
      return "已断开"
    case "error":
      return "异常"
    default:
      return "空闲"
  }
}
