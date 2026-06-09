import { useState, type ReactNode } from "react"
import { BotIcon, CameraIcon } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"

import { AgentAvatar } from "@/components/agent-avatar"
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
import { RadialIntro } from "@/components/animate-ui/components/community/radial-intro"
import { Ripple } from "@/components/ui/ripple"
import type { AgentDetail, AgentOverride, AgentSummary, AvatarOverridesManifest } from "../types"
import { AgentModelControl } from "./AgentModelControl"
import { ExternalAgentSettingsPanel } from "./ExternalAgentSettingsPanel"
import { AvatarEditDialog } from "./AvatarEditDialog"
import { useAvatarOverrides } from "../hooks/use-avatar-overrides"

type AgentDetailsPanelProps = {
  agent: AgentDetail | null
  agents: AgentSummary[]
  avatarManifest: AvatarOverridesManifest | null | undefined
  canConfigureModel: boolean
  loading: boolean
  onConfigureModel: () => void
}

const originLabels: Record<AgentDetail["origin"], string> = {
  external: "外部",
  system: "系统",
  user: "用户",
}

const entryPolicyLabels: Record<AgentDetail["entryPolicy"], string> = {
  callable: "可直接调用",
  default: "默认入口",
  "not-callable": "不可直接调用",
}

const delegationPolicyLabels: Record<AgentDetail["delegationPolicy"], string> = {
  "can-delegate": "可委派",
  "delegated-only": "仅被委派",
  terminal: "终端执行",
}

const executorLabels: Record<AgentDetail["executorType"], string> = {
  "ai-sdk": "AI SDK",
  "external-adapter": "外部适配器",
  mock: "Mock",
  orchestrator: "编排器",
}

const visibilityLabels: Record<AgentDetail["visibility"], string> = {
  hidden: "隐藏",
  visible: "可见",
}

const tierLabels: Record<AgentDetail["tier"], string> = {
  primary: "主智能体",
  subagent: "子智能体",
}

const permissionFieldLabels: Record<keyof AgentDetail["permissionPolicy"], string> = {
  deploy: "部署",
  filesystem: "文件",
  network: "网络",
  shell: "Shell",
}

const permissionValueLabels: Record<string, string> = {
  full: "完整",
  limited: "受限",
  none: "无",
  preview: "预览",
  publish: "发布",
  read: "读取",
  write: "写入",
}

function Section({
  children,
  description,
  title,
}: {
  children: ReactNode
  description?: string
  title: string
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {description ? (
          <p className="text-muted-foreground text-xs">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function InfoGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>
}

function InfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="min-w-0 break-words text-sm">{value}</span>
    </div>
  )
}

function ChipList({
  emptyText,
  items,
  variant = "secondary",
}: {
  emptyText: string
  items: string[]
  variant?: "outline" | "secondary"
}) {
  if (!items.length) {
    return <span className="text-muted-foreground text-sm">{emptyText}</span>
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Badge key={item} variant={variant}>
          {item}
        </Badge>
      ))}
    </div>
  )
}

function PermissionSummary({ agent }: { agent: AgentDetail }) {
  return (
    <div className="grid gap-2 sm:grid-cols-4">
      {Object.entries(agent.permissionPolicy).map(([permission, value]) => (
        <div
          className="flex min-w-0 flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2"
          key={permission}
        >
          <span className="text-muted-foreground text-xs">
            {permissionFieldLabels[
              permission as keyof AgentDetail["permissionPolicy"]
            ]}
          </span>
          <span className="truncate text-sm">
            {permissionValueLabels[value] ?? value}
          </span>
        </div>
      ))}
    </div>
  )
}

function HeaderSummary({ agent }: { agent: AgentDetail }) {
  const filesystemPermission = agent.permissionPolicy.filesystem
  const permissionLevel =
    filesystemPermission === "write"
      ? "可写工作区"
      : filesystemPermission === "read"
        ? "只读工作区"
        : "无文件权限"

  return (
    <div className="grid gap-4 border-border border-y py-4 sm:grid-cols-3">
      <InfoItem label="执行方式" value={executorLabels[agent.executorType]} />
      <InfoItem
        label="委派策略"
        value={delegationPolicyLabels[agent.delegationPolicy]}
      />
      <InfoItem label="权限级别" value={permissionLevel} />
    </div>
  )
}

function StatusBadges({ agent }: { agent: AgentDetail }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant="secondary">{originLabels[agent.origin]}</Badge>
      <Badge variant={agent.enabled ? "default" : "outline"}>
        {agent.enabled ? "已启用" : "已禁用"}
      </Badge>
      <Badge variant="outline">{entryPolicyLabels[agent.entryPolicy]}</Badge>
      {agent.readonly ? <Badge variant="outline">只读</Badge> : null}
    </div>
  )
}

function ModelSection({
  agent,
  canConfigureModel,
  onConfigureModel,
}: {
  agent: AgentDetail
  canConfigureModel: boolean
  onConfigureModel: () => void
}) {
  if (agent.origin === "external") {
    return (
      <Section
        description="配置 AgentHub 发起运行时传给外部 SDK 的轻量覆盖项。"
        title="外部 SDK 设置"
      >
        <ExternalAgentSettingsPanel agent={agent} />
      </Section>
    )
  }

  return (
    <Section description="绑定后运行时会使用该模型处理智能体请求。" title="模型">
      <AgentModelControl
        agent={agent}
        disabled={!canConfigureModel}
        onConfigure={onConfigureModel}
      />
    </Section>
  )
}

function DetailRows({ agent }: { agent: AgentDetail }) {
  return (
    <div className="flex flex-col gap-6 text-sm">
      <Section
        description="当前智能体在会话中的调用方式与运行边界。"
        title="运行概览"
      >
        <InfoGrid>
          <InfoItem label="类型" value={tierLabels[agent.tier]} />
          <InfoItem label="执行器" value={executorLabels[agent.executorType]} />
          <InfoItem
            label="入口策略"
            value={entryPolicyLabels[agent.entryPolicy]}
          />
          <InfoItem
            label="委派策略"
            value={delegationPolicyLabels[agent.delegationPolicy]}
          />
          <InfoItem label="可见性" value={visibilityLabels[agent.visibility]} />
          <InfoItem label="只读状态" value={agent.readonly ? "只读" : "可编辑"} />
        </InfoGrid>
      </Section>

      <Separator />

      <Section
        description="用于选择、筛选和理解智能体职责的能力标签。"
        title="能力标签"
      >
        <ChipList emptyText="未配置能力标签" items={agent.capabilities} />
      </Section>

      <Separator />

      <Section
        description="运行时允许该智能体调用的工具、子智能体和权限范围。"
        title="授权范围"
      >
        <div className="flex flex-col gap-4">
          <InfoItem
            label="可用工具"
            value={
              <ChipList
                emptyText="未开放工具"
                items={agent.allowedTools}
                variant="outline"
              />
            }
          />
          <InfoItem
            label="可委派子智能体"
            value={
              <ChipList
                emptyText="未配置子智能体"
                items={agent.allowedSubagents}
                variant="outline"
              />
            }
          />
          <PermissionSummary agent={agent} />
        </div>
      </Section>

      {agent.external ? (
        <>
          <Separator />
          <Section
            description="外部智能体通过 Runtime 适配器接入，浏览器不直接调用外部进程。"
            title="外部适配器"
          >
            <InfoGrid>
              <InfoItem label="Provider" value={agent.external.provider} />
              <InfoItem label="输出格式" value={agent.external.outputFormat} />
              <InfoItem
                label="工作区策略"
                value={agent.external.workingDirectoryPolicy}
              />
              <InfoItem
                label="配置目录策略"
                value={agent.external.configDirectoryPolicy}
              />
            </InfoGrid>
          </Section>
        </>
      ) : null}
    </div>
  )
}

function LoadingDetails() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-7">
      <div className="flex items-start gap-4">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </div>
      </div>
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-36 w-full" />
    </div>
  )
}

function EmptyState({
  agents,
  manifest,
}: {
  agents: AgentSummary[]
  manifest: AvatarOverridesManifest | null | undefined
}) {
  const orbitItems = agents.map((a, i) => ({
    id: i,
    name: a.name,
    content: (
      <AgentAvatar
        agent={a}
        override={manifest?.agents[a.id] ?? null}
        className="size-full"
      />
    ),
  }))

  if (orbitItems.length === 0) {
    return (
      <div className="relative h-full">
        <Ripple className="text-foreground/10" />
        <Empty className="h-full rounded-none border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BotIcon />
            </EmptyMedia>
            <EmptyTitle>选择一个智能体</EmptyTitle>
            <EmptyDescription>查看配置详情，或编辑你的自定义智能体。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  const hints = [
    "你想了解哪一个智能体？",
    "点击左侧，探索你的智能体",
    "选择一个智能体，开启对话",
    "哪位智能体引起你的注意？",
    "点击一位智能体，查看详情",
    "探索你的智能体团队",
    "选择一个智能体开始吧",
    "左侧选择一位，看看它的能力",
    "每位智能体都有独特的本领",
    "发现适合你的智能体",
  ]
  const hint = hints[Math.floor(Math.random() * hints.length)]

  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-6">
      <Ripple className="text-foreground/10" />
      <RadialIntro imageSize={48} orbitItems={orbitItems} stageSize={280} />
      <p className="text-muted-foreground/80 text-sm tracking-wide">
        {hint}
      </p>
    </div>
  )
}

function AgentDetailContent({
  agent,
  currentOverride,
  canConfigureModel,
  onConfigureModel,
  avatarEditOpen,
  onAvatarEditOpenChange,
}: {
  agent: AgentDetail
  currentOverride: AgentOverride | null
  canConfigureModel: boolean
  onConfigureModel: () => void
  avatarEditOpen: boolean
  onAvatarEditOpenChange: (open: boolean) => void
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-7">
        <div className="flex items-start gap-4">
          <button
            type="button"
            className="group relative shrink-0"
            onClick={() => onAvatarEditOpenChange(true)}
            title="自定义头像"
          >
            <AgentAvatar agent={agent} override={currentOverride} size="lg" />
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 transition-colors group-hover:bg-black/40">
              <CameraIcon className="size-4 text-white opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex min-w-0 flex-col gap-2">
              <h2 className="min-w-0 truncate text-xl font-semibold">
                {agent.name}
              </h2>
              <p className="max-w-2xl text-muted-foreground text-sm">
                {agent.description}
              </p>
            </div>
            <StatusBadges agent={agent} />
          </div>
        </div>

        <HeaderSummary agent={agent} />

        <ModelSection
          agent={agent}
          canConfigureModel={canConfigureModel}
          onConfigureModel={onConfigureModel}
        />

        <Separator />

        <DetailRows agent={agent} />

        <AvatarEditDialog
          agent={agent}
          currentOverride={currentOverride}
          open={avatarEditOpen}
          onOpenChange={onAvatarEditOpenChange}
        />
      </div>
    </ScrollArea>
  )
}

export function AgentDetailsPanel({
  agent,
  agents,
  avatarManifest,
  canConfigureModel,
  loading,
  onConfigureModel,
}: AgentDetailsPanelProps) {
  const [avatarEditOpen, setAvatarEditOpen] = useState(false)
  const { data: localManifest } = useAvatarOverrides()
  const manifest = avatarManifest ?? localManifest
  const currentOverride = agent ? (manifest?.agents[agent.id] ?? null) : null

  const contentKey = loading ? "loading" : agent ? `agent-${agent.id}` : "empty"

  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        key={contentKey}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="h-full"
      >
        {loading ? (
          <LoadingDetails />
        ) : !agent ? (
          <EmptyState
            agents={agents}
            manifest={manifest}
          />
        ) : (
          <AgentDetailContent
            agent={agent}
            currentOverride={currentOverride}
            canConfigureModel={canConfigureModel}
            onConfigureModel={onConfigureModel}
            avatarEditOpen={avatarEditOpen}
            onAvatarEditOpenChange={setAvatarEditOpen}
          />
        )}
      </motion.div>
    </AnimatePresence>
  )
}
