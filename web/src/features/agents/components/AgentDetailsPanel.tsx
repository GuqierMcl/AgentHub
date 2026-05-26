import { BotIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"

import type { AgentDetail } from "../types"
import { AgentModelControl } from "./AgentModelControl"

type AgentDetailsPanelProps = {
  agent: AgentDetail | null
  canConfigureModel: boolean
  loading: boolean
  onConfigureModel: () => void
}

const originLabels = {
  external: "外部",
  system: "系统",
  user: "用户",
}

function DetailRows({ agent }: { agent: AgentDetail }) {
  return (
    <div className="flex flex-col gap-5 text-sm">
      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-xs">能力标签</span>
        <div className="flex flex-wrap gap-2">
          {agent.capabilities.length ? (
            agent.capabilities.map((capability) => (
              <Badge key={capability} variant="secondary">
                {capability}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground">未配置</span>
          )}
        </div>
      </div>
      <Separator />
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">执行器</span>
          <span>{agent.executorType}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">委派策略</span>
          <span>{agent.delegationPolicy}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">可用工具</span>
          <span>{agent.allowedTools.join(", ") || "未配置"}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">子智能体</span>
          <span>{agent.allowedSubagents.join(", ") || "未配置"}</span>
        </div>
      </div>
      {agent.external ? (
        <>
          <Separator />
          <div className="flex flex-col gap-3">
            <span className="text-muted-foreground text-xs">外部执行配置</span>
            <div className="grid grid-cols-2 gap-4">
              <span>Provider: {agent.external.provider}</span>
              <span>Format: {agent.external.outputFormat}</span>
              <span>Workspace: {agent.external.workingDirectoryPolicy}</span>
              <span>Config: {agent.external.configDirectoryPolicy}</span>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

export function AgentDetailsPanel({
  agent,
  canConfigureModel,
  loading,
  onConfigureModel,
}: AgentDetailsPanelProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-5 p-7">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (!agent) {
    return (
      <Empty className="h-full rounded-none border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BotIcon />
          </EmptyMedia>
          <EmptyTitle>选择一个智能体</EmptyTitle>
          <EmptyDescription>查看配置详情，或编辑你的自定义智能体。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 p-7">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold">{agent.name}</h2>
            <Badge variant="secondary">{originLabels[agent.origin]}</Badge>
            <Badge variant={agent.enabled ? "default" : "outline"}>
              {agent.enabled ? "已启用" : "已禁用"}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">{agent.description}</p>
          {agent.origin === "external" ? null : (
            <AgentModelControl
              agent={agent}
              disabled={!canConfigureModel}
              onConfigure={onConfigureModel}
            />
          )}
        </div>
        <DetailRows agent={agent} />
      </div>
    </ScrollArea>
  )
}
