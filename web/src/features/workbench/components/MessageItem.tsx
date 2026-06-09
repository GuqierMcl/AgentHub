import {
  CheckCircleIcon,
  CheckIcon,
  CircleAlertIcon,
  ClockIcon,
  Loader2Icon,
  PinIcon,
  ReplyIcon,
  RefreshCwIcon,
  XCircleIcon,
} from "lucide-react"
import { CopyIcon } from "@/components/ui/copy"
import { memo, useCallback, useMemo, useState, type ReactNode } from "react"

import {
  Message,
  MessageAction,
  MessageActions,
  MessageBranch,
  MessageBranchContent,
  MessageBranchNext,
  MessageBranchPage,
  MessageBranchPrevious,
  MessageBranchSelector,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
  type AttachmentData,
} from "@/components/ai-elements/attachments"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning"
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources"
import {
  Task,
  TaskContent,
  TaskItem,
  TaskTrigger,
} from "@/components/ai-elements/task"
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ai-elements/code-block"
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalTitle,
} from "@/components/ai-elements/terminal"
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
  type ConfirmationProps,
} from "@/components/ai-elements/confirmation"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { ToolUIPart } from "ai"

import type {
  ConversationAgentProfile,
  MessageRegenerateSnapshot,
  MessageReplySnapshot,
  MessageVersion,
  WorkbenchMessageAttachment,
  WorkbenchTimelineChatMessageItem,
  WorkbenchTimelineItem,
  WorkbenchTimelinePermissionItem,
  WorkbenchTimelineQuestionItem,
  WorkbenchTimelineReasoningBlock,
  WorkbenchTimelineReasoningItem,
  WorkbenchTimelineRunStatusItem,
  WorkbenchTimelineTaskItem,
  WorkbenchTimelineToolItem,
} from "../types"
import { conversationMessagesApi } from "../api/messages"
import { AgentAvatar } from "./AgentAvatar"
import { ArtifactPreview } from "./ArtifactPreview"
import { useAgentOverride } from "@/features/agents/hooks/use-avatar-overrides"

type TimelineItemProps = {
  item: WorkbenchTimelineItem
  agentProfiles: ConversationAgentProfile[]
  pinTargetMessageId?: string | null
  isPinned?: boolean
  onPinToggle?: (messageId: string) => void
  onReply?: (target: MessageReplySnapshot) => void
  onRegenerate?: (messageId: string) => void
  pinnedMessageIds?: Set<string>
}

type GenerationMetadata = NonNullable<WorkbenchTimelineChatMessageItem["generation"]>
type ExternalModelMetadata = NonNullable<WorkbenchTimelineChatMessageItem["externalModel"]>

type NestedBlock =
  | { kind: "reasoning"; order: number; key: string; block: WorkbenchTimelineReasoningBlock }
  | { kind: "permission"; order: number; key: string; item: WorkbenchTimelinePermissionItem }
  | { kind: "question"; order: number; key: string; item: WorkbenchTimelineQuestionItem }
  | { kind: "tool"; order: number; key: string; item: WorkbenchTimelineToolItem }

const REPLY_EXCERPT_LENGTH = 300

// Merge a message/task's nested blocks into a single list ordered by their
// projection `order`, so reasoning and tool calls render in the real sequence
// they happened (think -> tool -> think -> tool) instead of bucketed by kind.
// Falls back to the legacy bucket order when `order` is absent (older data).
function mergeNestedBlocks(parent: {
  id: string
  reasoningBlocks?: WorkbenchTimelineReasoningBlock[]
  permissionItems?: WorkbenchTimelinePermissionItem[]
  questionItems?: WorkbenchTimelineQuestionItem[]
  toolItems?: WorkbenchTimelineToolItem[]
}): NestedBlock[] {
  const blocks: NestedBlock[] = []
  let fallback = 0

  for (const block of parent.reasoningBlocks ?? []) {
    blocks.push({
      kind: "reasoning",
      order: block.order ?? fallback,
      key: `${block.messageId ?? parent.id}:${block.reasoningId}`,
      block,
    })
    fallback += 1
  }
  for (const item of parent.permissionItems ?? []) {
    blocks.push({ kind: "permission", order: item.order ?? fallback, key: item.id, item })
    fallback += 1
  }
  for (const item of parent.questionItems ?? []) {
    blocks.push({ kind: "question", order: item.order ?? fallback, key: item.id, item })
    fallback += 1
  }
  for (const item of parent.toolItems ?? []) {
    blocks.push({ kind: "tool", order: item.order ?? fallback, key: item.id, item })
    fallback += 1
  }

  return blocks
    .map((block, index) => ({ block, index }))
    .sort((left, right) =>
      left.block.order !== right.block.order
        ? left.block.order - right.block.order
        : left.index - right.index
    )
    .map(({ block }) => block)
}

function NestedBlockView({ block }: { block: NestedBlock }) {
  switch (block.kind) {
    case "reasoning":
      return <ReasoningBlockView block={block.block} />
    case "permission":
      return <PermissionBlockView item={block.item} />
    case "question":
      return <QuestionBlockView item={block.item} />
    case "tool":
      return <ToolBlockView item={block.item} />
  }
}

export const TimelineItem = memo(function TimelineItem({
  agentProfiles,
  item,
  pinTargetMessageId,
  isPinned,
  onPinToggle,
  onReply,
  onRegenerate,
  pinnedMessageIds,
}: TimelineItemProps) {
  switch (item.kind) {
    case "chat_message":
      return (
        <ChatMessageItem
          agentProfiles={agentProfiles}
          isPinned={isPinned}
          item={item}
          onPinToggle={onPinToggle}
          onReply={onReply}
          onRegenerate={onRegenerate}
          pinnedMessageIds={pinnedMessageIds}
          pinTargetMessageId={pinTargetMessageId}
        />
      )
    case "task":
      return <TaskTimelineItem item={item} />
    case "tool":
      return <ToolTimelineItem item={item} />
    case "permission":
      return <PermissionTimelineItem item={item} />
    case "question":
      return <QuestionTimelineItem item={item} />
    case "reasoning":
      return <ReasoningTimelineItem item={item} />
    case "plan":
      return null
    case "run_status":
      return <RunStatusTimelineItem item={item} />
  }
})

function ChatMessageItem({
  agentProfiles,
  item,
  pinTargetMessageId,
  isPinned,
  onPinToggle,
  onReply,
  onRegenerate,
  pinnedMessageIds,
}: {
  item: WorkbenchTimelineChatMessageItem
  agentProfiles: ConversationAgentProfile[]
  pinTargetMessageId?: string | null
  isPinned?: boolean
  onPinToggle?: (messageId: string) => void
  onReply?: (target: MessageReplySnapshot) => void
  onRegenerate?: (messageId: string) => void
  pinnedMessageIds?: Set<string>
}) {
  const versions = useMemo(
    () =>
      item.versions?.length
        ? item.versions
        : [createDefaultMessageVersion(item, pinTargetMessageId)],
    [item, pinTargetMessageId]
  )
  const branchKey = useMemo(
    () => `${item.id}:${versions.map((version) => version.id).join("|")}`,
    [item.id, versions]
  )
  const defaultBranchIndex = Math.max(versions.length - 1, 0)

  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    const text = versions.map((v) => v.content).join("\n")
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [versions])

  const handleReply = useCallback((
    messageId: string,
    content: string,
    targetItem: WorkbenchTimelineChatMessageItem,
    targetAgent: ConversationAgentProfile
  ) => {
    onReply?.(
      createReplyTargetFromTimelineItem(
        targetItem,
        targetAgent,
        messageId,
        content
      )
    )
  }, [onReply])

  return (
    <MessageBranch defaultBranch={defaultBranchIndex} key={branchKey}>
      <MessageBranchContent>
        {versions.map((version) => {
          const versionItem = applyVersionToTimelineItem(item, version)
          const versionAgent = resolveAgentProfile(agentProfiles, versionItem.agentId)
          const versionTargetMessageId = version.messageId ?? pinTargetMessageId
          const displayContent = getChatDisplayContent(
            versionItem,
            version.content
          )
          const isRegenerateParticipant =
            versionItem.role === "assistant" &&
            (versions.length > 1 || Boolean(versionItem.regeneratedFromId))
          const versionIsPinned = versionTargetMessageId
            ? pinnedMessageIds?.has(versionTargetMessageId) ??
              (versionTargetMessageId === pinTargetMessageId ? isPinned ?? false : false)
            : false

          return (
            <Message from={versionItem.role} key={version.id}>
              <div className="flex max-w-full flex-col gap-2">
                {versionItem.role === "assistant" ? (
                  <AgentHeader agent={versionAgent} time={versionItem.time} />
                ) : (
                  <div className="text-right text-muted-foreground text-xs">
                    {versionItem.time}
                  </div>
                )}

                {versionItem.sources?.length ? (
                  <Sources>
                    <SourcesTrigger count={versionItem.sources.length} />
                    <SourcesContent>
                      {versionItem.sources.map((source) => (
                        <Source
                          href={source.href}
                          key={source.href}
                          title={source.title}
                        />
                      ))}
                    </SourcesContent>
                  </Sources>
                ) : null}

                {mergeNestedBlocks(versionItem).map((block) => (
                  <NestedBlockView block={block} key={block.key} />
                ))}

                <MessageContent className="max-w-[min(680px,100%)]">
                  {versionItem.regenerate ? (
                    <RegenerateRequestMarker regenerate={versionItem.regenerate} />
                  ) : null}
                  {versionItem.regeneratedFromId ? <RegeneratedMarker /> : null}
                  {versionItem.replyTo ? <ReplyPreview replyTo={versionItem.replyTo} /> : null}
                  {displayContent ? (
                    <MessageResponse>{displayContent}</MessageResponse>
                  ) : null}
                  {versionItem.attachments?.length ? (
                    <MessageAttachments attachments={versionItem.attachments} />
                  ) : null}
                  {versionItem.role === "user" && versionItem.regenerateRequests?.length ? (
                    <RegenerateRequestSummary
                      count={versionItem.regenerateRequests.length}
                    />
                  ) : null}
                  {versionItem.role !== "user" && versionItem.status === "streaming" ? (
                    <div className="mt-2 flex items-center gap-2 text-muted-foreground text-xs">
                      <Loader2Icon className="size-3.5 animate-spin" />
                      <span>正在生成...</span>
                    </div>
                  ) : null}
                  {versionItem.artifacts?.length ? (
                    <div className="mt-3 flex flex-col gap-2">
                      {versionItem.artifacts.map((artifact) => (
                        <ArtifactPreview artifact={artifact} key={artifact.id} />
                      ))}
                    </div>
                  ) : null}
                </MessageContent>

                <MessageActions
                  className={versionItem.role === "user" ? "justify-end" : undefined}
                >
                  {isRegenerateParticipant ? <RegeneratedActionLabel /> : null}
                  {versionItem.role === "assistant" ? (
                    <MessageModelLabel
                      externalModel={versionItem.externalModel}
                      generation={versionItem.generation}
                    />
                  ) : null}
                  <MessageAction label="Copy message" tooltip={copied ? "Copied!" : "Copy"} onClick={handleCopy}>
                    {copied ? <CheckIcon /> : <CopyIcon className="![&_svg]:size-4" size={16} />}
                  </MessageAction>
                  {onReply && versionTargetMessageId ? (
                    <MessageAction
                      label="Reply message"
                      tooltip="回复"
                      onClick={() =>
                        handleReply(
                          versionTargetMessageId,
                          version.content,
                          versionItem,
                          versionAgent
                        )
                      }
                    >
                      <ReplyIcon />
                    </MessageAction>
                  ) : null}
                  {versionItem.role === "assistant" &&
                  versionItem.status !== "streaming" &&
                  onRegenerate &&
                  versionTargetMessageId ? (
                    <MessageAction
                      label="Regenerate message"
                      tooltip="重新生成"
                      onClick={() => onRegenerate(versionTargetMessageId)}
                    >
                      <RefreshCwIcon />
                    </MessageAction>
                  ) : null}
                  {onPinToggle && versionTargetMessageId ? (
                    <MessageAction
                      label={versionIsPinned ? "Unpin message" : "Pin message"}
                      tooltip={versionIsPinned ? "取消置顶" : "置顶消息"}
                      onClick={() => onPinToggle(versionTargetMessageId)}
                    >
                      <PinIcon className={versionIsPinned ? "fill-current text-primary" : ""} />
                    </MessageAction>
                  ) : null}
                </MessageActions>
              </div>
            </Message>
          )
        })}
      </MessageBranchContent>
      {versions.length > 1 ? (
        <MessageBranchSelector className="ml-auto">
          <MessageBranchPrevious />
          <MessageBranchPage />
          <MessageBranchNext />
        </MessageBranchSelector>
      ) : null}
    </MessageBranch>
  )
}

function MessageAttachments({
  attachments,
}: {
  attachments: WorkbenchMessageAttachment[]
}) {
  return (
    <Attachments
      className="ml-0 max-w-full justify-start"
      variant="grid"
    >
      {attachments.map((attachment) => (
        <Attachment data={toAttachmentData(attachment)} key={attachment.id}>
          <AttachmentPreview />
          <AttachmentInfo />
        </Attachment>
      ))}
    </Attachments>
  )
}

function toAttachmentData(
  attachment: WorkbenchMessageAttachment
): AttachmentData {
  return {
    id: attachment.id,
    type: "file",
    url: attachment.url,
    filename: attachment.filename,
    mediaType: attachment.mediaType,
  }
}

function RegeneratedMarker() {
  return (
    <div className="mb-2 inline-flex w-fit items-center gap-1.5 rounded-sm bg-muted px-2 py-1 text-muted-foreground text-xs">
      <RefreshCwIcon className="size-3" />
      <span>重新生成回复</span>
    </div>
  )
}

function RegeneratedActionLabel() {
  return (
    <span className="mr-1 inline-flex max-w-64 items-center gap-1 rounded-sm px-1 text-muted-foreground text-xs leading-7">
      <RefreshCwIcon className="size-3" />
      <span>已重新生成</span>
    </span>
  )
}

function RegenerateRequestSummary({ count }: { count: number }) {
  return (
    <div className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-sm bg-background/60 px-2 py-1 text-muted-foreground text-xs">
      <RefreshCwIcon className="size-3" />
      <span>已请求重新生成 {count} 次</span>
    </div>
  )
}

function RegenerateRequestMarker({
  regenerate,
}: {
  regenerate: MessageRegenerateSnapshot
}) {
  return (
    <div className="mb-2 max-w-full rounded-sm border border-border/70 bg-muted/40 px-2.5 py-2 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
        <RefreshCwIcon className="size-3" />
        <span>重新生成请求</span>
      </div>
      <div className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-muted-foreground/90">
        源回复：{regenerate.sourceAssistantExcerpt}
      </div>
    </div>
  )
}

function createDefaultMessageVersion(
  item: WorkbenchTimelineChatMessageItem,
  messageId?: string | null
): MessageVersion {
  return {
    id: messageId ?? `${item.id}-default`,
    ...(messageId ? { messageId } : {}),
    ...(item.regeneratedFromId ? { regeneratedFromId: item.regeneratedFromId } : {}),
    content: item.text,
    ...(item.attachments?.length ? { attachments: item.attachments } : {}),
    ...(item.agentId ? { agentId: item.agentId } : {}),
    time: item.time,
    ...(item.status ? { status: item.status } : {}),
    ...(item.generation ? { generation: item.generation } : {}),
    ...(item.externalModel ? { externalModel: item.externalModel } : {}),
    ...(item.replyTo ? { replyTo: item.replyTo } : {}),
    ...(item.regenerate ? { regenerate: item.regenerate } : {}),
    ...(item.regenerateRequests?.length ? { regenerateRequests: item.regenerateRequests } : {}),
    ...(item.reasoningBlocks?.length ? { reasoningBlocks: item.reasoningBlocks } : {}),
    ...(item.toolItems?.length ? { toolItems: item.toolItems } : {}),
    ...(item.permissionItems?.length ? { permissionItems: item.permissionItems } : {}),
    ...(item.questionItems?.length ? { questionItems: item.questionItems } : {}),
    ...(item.sources?.length ? { sources: item.sources } : {}),
    ...(item.artifacts?.length ? { artifacts: item.artifacts } : {}),
  }
}

function applyVersionToTimelineItem(
  item: WorkbenchTimelineChatMessageItem,
  version: MessageVersion
): WorkbenchTimelineChatMessageItem {
  return {
    ...item,
    agentId: version.agentId ?? item.agentId,
    text: version.content,
    attachments: version.attachments ?? getFallbackVersionAttachments(item, version),
    time: version.time ?? item.time,
    status: version.status ?? item.status,
    generation: version.generation,
    externalModel: version.externalModel,
    replyTo: version.replyTo,
    regenerate: version.regenerate,
    regenerateRequests: version.regenerateRequests,
    regeneratedFromId: version.regeneratedFromId,
    reasoningBlocks: version.reasoningBlocks,
    toolItems: version.toolItems,
    permissionItems: version.permissionItems,
    questionItems: version.questionItems,
    sources: version.sources,
    artifacts: version.artifacts,
  }
}

function getFallbackVersionAttachments(
  item: WorkbenchTimelineChatMessageItem,
  version: MessageVersion
): WorkbenchMessageAttachment[] | undefined {
  if (version.regeneratedFromId) return undefined

  const versionTargetsItem =
    !version.messageId ||
    version.messageId === item.persistedMessageId ||
    version.id === item.persistedMessageId ||
    version.id === item.id
  return versionTargetsItem ? item.attachments : undefined
}

function ReplyPreview({ replyTo }: { replyTo: MessageReplySnapshot }) {
  return (
    <div className="mb-2 max-w-full border-border/70 border-l-2 pl-3 text-xs">
      <div className="truncate font-medium text-muted-foreground">
        回复 {formatReplyTargetLabel(replyTo)}
      </div>
      <div className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-muted-foreground/90">
        {replyTo.excerpt}
      </div>
    </div>
  )
}

function createReplyTargetFromTimelineItem(
  item: WorkbenchTimelineChatMessageItem,
  agent: ConversationAgentProfile,
  messageId: string,
  content: string
): MessageReplySnapshot {
  const isUser = item.role === "user"
  const agentId = isUser ? null : item.agentId ?? agent.id
  return {
    messageId,
    role: item.role,
    senderType: isUser ? "user" : "agent",
    senderId: isUser ? "user" : agentId,
    agentId,
    createdAt: "",
    excerpt: truncateReplyExcerpt(content),
  }
}

function truncateReplyExcerpt(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim()
  if (!compact) return "消息"
  if (compact.length <= REPLY_EXCERPT_LENGTH) return compact
  return `${compact.slice(0, REPLY_EXCERPT_LENGTH)}...`
}

function formatReplyTargetLabel(replyTo: MessageReplySnapshot): string {
  const sender = replyTo.agentId ?? replyTo.senderId
  return sender && sender !== replyTo.role
    ? `${replyTo.role} ${sender}`
    : replyTo.role
}

function MessageModelLabel({
  externalModel,
  generation,
}: {
  externalModel?: ExternalModelMetadata
  generation?: GenerationMetadata
}) {
  const label = generation
    ? formatGenerationLabel(generation)
    : externalModel
      ? formatExternalModelLabel(externalModel)
      : null
  if (!label) {
    return null
  }

  const rows = generation
    ? getGenerationTooltipRows(generation)
    : externalModel
      ? getExternalModelTooltipRows(externalModel)
      : []
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="mr-1 inline-flex max-w-64 cursor-default items-center truncate rounded-sm px-1 text-muted-foreground text-xs leading-7">
          {label}
        </span>
      </TooltipTrigger>
      {rows.length ? (
        <TooltipContent className="block max-w-sm px-3 py-2 text-left">
          <div className="grid gap-1">
            {rows.map((row) => (
              <div className="grid grid-cols-[auto_1fr] gap-3" key={row.label}>
                <span className="text-background/70">{row.label}</span>
                <span className="break-all">{row.value}</span>
              </div>
            ))}
          </div>
        </TooltipContent>
      ) : null}
    </Tooltip>
  )
}

function formatGenerationLabel(generation: GenerationMetadata): string | null {
  const modelName = generation.model?.modelName
  if (!modelName) {
    return null
  }

  const totalTokens = generation.usage?.totalTokens
  if (typeof totalTokens === "number") {
    return `${modelName} · ${formatCompactNumber(totalTokens)} tokens`
  }

  return modelName
}

function formatExternalModelLabel(model: ExternalModelMetadata): string {
  return `${formatExternalProvider(model.provider)} · ${getExternalModelDisplayName(model)}`
}

function getGenerationTooltipRows(
  generation: GenerationMetadata
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  const model = generation.model
  if (model) {
    rows.push({ label: "Model", value: model.modelName })
    rows.push({ label: "Provider", value: model.providerName })
    rows.push({ label: "Model ID", value: `${model.providerId}/${model.modelId}` })
    if (model.modelSourceAgentId) {
      rows.push({ label: "Source", value: model.modelSourceAgentId })
    }
  }

  const usage = generation.usage
  if (usage?.inputTokens !== undefined) {
    rows.push({ label: "Input", value: formatTokenCount(usage.inputTokens) })
  }
  if (usage?.outputTokens !== undefined) {
    rows.push({ label: "Output", value: formatTokenCount(usage.outputTokens) })
  }
  if (usage?.totalTokens !== undefined) {
    rows.push({ label: "Total", value: formatTokenCount(usage.totalTokens) })
  }
  if (usage?.reasoningTokens !== undefined) {
    rows.push({ label: "Reasoning", value: formatTokenCount(usage.reasoningTokens) })
  }
  if (usage?.cachedInputTokens !== undefined) {
    rows.push({ label: "Cached", value: formatTokenCount(usage.cachedInputTokens) })
  }
  if (generation.durationMs !== undefined) {
    rows.push({ label: "Duration", value: formatGenerationDuration(generation.durationMs) })
  }
  if (generation.finishReason) {
    rows.push({ label: "Finish", value: generation.finishReason })
  }

  return rows
}

function getExternalModelTooltipRows(
  model: ExternalModelMetadata
): Array<{ label: string; value: string }> {
  return [
    { label: "External", value: formatExternalProvider(model.provider) },
    { label: "Provider", value: model.providerName ?? model.providerId },
    { label: "Model", value: getExternalModelDisplayName(model) },
    { label: "Model ID", value: `${model.providerId}/${model.modelId}` },
  ]
}

function getExternalModelDisplayName(model: ExternalModelMetadata): string {
  return model.modelName ?? humanizeModelId(model.modelId)
}

function formatExternalProvider(provider: string): string {
  if (provider === "opencode") {
    return "OpenCode"
  }
  return provider
}

function humanizeModelId(modelId: string): string {
  const knownParts: Record<string, string> = {
    gpt: "GPT",
    claude: "Claude",
    sonnet: "Sonnet",
    opus: "Opus",
    haiku: "Haiku",
    gemini: "Gemini",
    deepseek: "DeepSeek",
    qwen: "Qwen",
    llama: "Llama",
    mistral: "Mistral",
    mini: "Mini",
    turbo: "Turbo",
    pro: "Pro",
    flash: "Flash",
  }

  return modelId
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((part) => knownParts[part.toLowerCase()] ?? titleCaseModelIdPart(part))
    .join(" ")
}

function titleCaseModelIdPart(part: string): string {
  if (/^\d+(?:\.\d+)?[a-z]?$/i.test(part)) {
    return part
  }
  if (part.length <= 3 && part === part.toUpperCase()) {
    return part
  }
  return `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`
}

function formatTokenCount(value: number): string {
  return `${new Intl.NumberFormat().format(value)} tokens`
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${trimDecimal(value / 1_000_000)}M`
  }
  if (value >= 1_000) {
    return `${trimDecimal(value / 1_000)}k`
  }
  return String(value)
}

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "")
}

function formatGenerationDuration(durationMs: number): string {
  if (durationMs >= 1000) {
    return `${trimDecimal(durationMs / 1000)}s`
  }
  return `${Math.round(durationMs)}ms`
}

function ToolTimelineItem({ item }: { item: WorkbenchTimelineToolItem }) {
  return (
    <TimelineCard>
      <ToolBlockView item={item} />
    </TimelineCard>
  )
}

function TaskTimelineItem({ item }: { item: WorkbenchTimelineTaskItem }) {
  return (
    <TimelineCard>
      <Task className="max-w-[min(720px,100%)]" defaultOpen={item.status !== "completed"}>
        <TaskTrigger title={item.title} />
        <TaskContent>
          <TaskItem>
            <span className="mr-2 inline-flex align-middle">
              <TimelineStatusBadge status={item.status} />
            </span>
            {item.targetAgentId ? `Target: ${item.targetAgentId}` : "Agent task"}
          </TaskItem>
          {item.text ? (
            <TaskItem className="whitespace-pre-wrap">{item.text}</TaskItem>
          ) : null}
          {mergeNestedBlocks(item).map((block) => (
            <TaskItem key={block.key}>
              <NestedBlockView block={block} />
            </TaskItem>
          ))}
          {item.error ? (
            <TaskItem className="text-destructive">{item.error}</TaskItem>
          ) : null}
        </TaskContent>
      </Task>
    </TimelineCard>
  )
}

function PermissionTimelineItem({
  item,
}: {
  item: WorkbenchTimelinePermissionItem
}) {
  return (
    <TimelineCard>
      <PermissionBlockView item={item} />
    </TimelineCard>
  )
}

function ReasoningTimelineItem({
  item,
}: {
  item: WorkbenchTimelineReasoningItem
}) {
  return (
    <TimelineCard>
      <ReasoningBlockView block={item} />
    </TimelineCard>
  )
}

function ToolBlockView({ item }: { item: WorkbenchTimelineToolItem }) {
  if (item.toolName === "edit_file" && !item.externalProvider) {
    return <EditFileDiffView item={item} />
  }

  if (item.toolName === "bash" && !item.externalProvider) {
    return <BashToolTerminalView item={item} />
  }

  return (
    <Tool className="mb-0 max-w-[min(720px,100%)]" defaultOpen={false} >
      <ToolHeader
        state={item.status}
        title={item.title}
        type={`tool-${item.toolName}` as ToolUIPart["type"]}
      />
      <ToolContent>
        {item.input !== undefined ? <ToolInput input={item.input} /> : null}
        <ToolOutput errorText={item.errorText} output={item.output} />
      </ToolContent>
    </Tool>
  )
}

function EditFileDiffView({ item }: { item: WorkbenchTimelineToolItem }) {
  const data = getRecord(item.output)
  const input = getRecord(item.input)
  const diff = getRecord(data?.diff)
  const diffText = getString(diff?.text)
  const path = getString(data?.path) ?? getString(input?.path) ?? item.title
  const metaItems = formatEditFileMetaItems(item, data, diff)

  if (!diffText) {
    return (
      <EditFileStatusView
        errorText={item.errorText}
        metaItems={metaItems}
        path={path}
        status={item.status}
      />
    )
  }

  return (
    <CodeBlock
      className="not-prose mb-0 max-w-[min(720px,100%)] rounded-md shadow-sm"
      code={diffText}
      language="diff"
      showLineNumbers={false}
    >
      <CodeBlockHeader className="gap-3">
        <CodeBlockTitle className="min-w-0 flex-1">
          <CodeBlockFilename className="truncate">{path}</CodeBlockFilename>
        </CodeBlockTitle>
        <CodeBlockActions>
          {metaItems.length ? (
            <div className="hidden max-w-72 truncate text-muted-foreground text-xs sm:block">
              {metaItems.join(" / ")}
            </div>
          ) : null}
          <CodeBlockCopyButton
            aria-label="Copy edit diff"
            className="size-7"
          />
        </CodeBlockActions>
      </CodeBlockHeader>
    </CodeBlock>
  )
}

function EditFileStatusView({
  errorText,
  metaItems,
  path,
  status,
}: {
  errorText?: string
  metaItems: string[]
  path: string
  status: WorkbenchTimelineToolItem["status"]
}) {
  const failed = status === "output-error" || Boolean(errorText)
  const running = status === "input-available" || status === "input-streaming"
  const statusIcon = failed ? (
    <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
  ) : running ? (
    <Loader2Icon className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
  ) : (
    <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-green-600" />
  )

  return (
    <div className="not-prose flex max-w-[min(720px,100%)] items-start gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
      {statusIcon}
      <div className="min-w-0 flex-1">
        <div className={failed ? "truncate text-destructive" : "truncate text-foreground"}>
          {path}
        </div>
        {metaItems.length ? (
          <div className="mt-1 truncate text-muted-foreground text-xs">
            {metaItems.join(" / ")}
          </div>
        ) : null}
        {errorText ? (
          <div className="mt-2 text-destructive text-xs">{errorText}</div>
        ) : null}
      </div>
    </div>
  )
}

function QuestionTimelineItem({
  item,
}: {
  item: WorkbenchTimelineQuestionItem
}) {
  return (
    <TimelineCard>
      <QuestionBlockView item={item} />
    </TimelineCard>
  )
}

function BashToolTerminalView({ item }: { item: WorkbenchTimelineToolItem }) {
  const data = getRecord(item.output)
  const isStreaming = item.status === "input-available" || item.status === "input-streaming"

  if (!data) {
    const fallbackOutput = formatBashFallbackTerminalOutput(item)
    return (
      <Terminal
        autoScroll={isStreaming}
        className="not-prose mb-0 w-full max-w-[min(720px,100%)] rounded-md border-zinc-800 shadow-md"
        isStreaming={isStreaming}
        output={fallbackOutput}
      >
        <TerminalHeader className="gap-3 px-3 py-2">
          <TerminalTitle className="min-w-0 flex-1">
            <span className="truncate">{item.title || "bash"}</span>
          </TerminalTitle>
          <BashTerminalHeaderActions
            metaItems={[formatToolStatusLabel(item.status)]}
          />
        </TerminalHeader>
        <TerminalContent className="max-h-80 p-3 text-xs" />
      </Terminal>
    )
  }

  const stdout = getString(data.stdout) ?? ""
  const stderr = getString(data.stderr) ?? ""
  const stdoutCharacters = getNumber(data.stdoutCharacters) ?? stdout.length
  const stderrCharacters = getNumber(data.stderrCharacters) ?? stderr.length
  const stdoutTruncated = data.stdoutTruncatedForDisplay === true || data.stdoutTruncatedForUi === true
  const stderrTruncated = data.stderrTruncatedForDisplay === true || data.stderrTruncatedForUi === true
  const command = getString(data.command)
  const cwd = getString(data.cwd) ?? "."
  const exitCode = formatUnknown(data.exitCode)
  const duration = formatDurationMs(data.durationMs)
  const shell = getString(data.shell)
  const hasContent = command || stdout || stderr || item.errorText || isStreaming

  if (!hasContent) {
    return null
  }

  const terminalOutput = formatBashTerminalOutput({
    command,
    cwd,
    errorText: item.errorText,
    stderr,
    stderrCharacters,
    stderrTruncated,
    stdout,
    stdoutCharacters,
    stdoutTruncated,
  })
  const metaItems = [
    formatToolStatusLabel(item.status),
    shell,
    `cwd ${cwd}`,
    `exit ${exitCode}`,
    duration !== "-" ? duration : undefined,
    data.truncated === true || stdoutTruncated || stderrTruncated ? "preview" : undefined,
  ].filter((metaItem): metaItem is string => Boolean(metaItem))

  return (
    <Terminal
      autoScroll={isStreaming}
      className="not-prose mb-0 w-full max-w-[min(720px,100%)] rounded-md border-zinc-800 shadow-md"
      isStreaming={isStreaming}
      output={terminalOutput}
    >
      <TerminalHeader className="gap-3 px-3 py-2">
        <TerminalTitle className="min-w-0 flex-1">
          <span className="truncate">{command ?? item.title ?? "bash"}</span>
        </TerminalTitle>
        <BashTerminalHeaderActions metaItems={metaItems} />
      </TerminalHeader>
      <TerminalContent className="max-h-80 p-3 text-xs" />
    </Terminal>
  )
}

function BashTerminalHeaderActions({ metaItems }: { metaItems: string[] }) {
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2">
      <div className="hidden max-w-80 truncate text-zinc-500 text-xs sm:block">
        {metaItems.join(" / ")}
      </div>
      <TerminalActions>
        <TerminalCopyButton />
      </TerminalActions>
    </div>
  )
}

function formatBashFallbackTerminalOutput(item: WorkbenchTimelineToolItem): string {
  if (item.errorText) return `error: ${item.errorText}`
  if (typeof item.output === "string") return item.output
  if (item.output !== undefined && item.output !== null) return String(item.output)
  return ""
}

function formatToolStatusLabel(status: WorkbenchTimelineToolItem["status"]): string {
  switch (status) {
    case "input-streaming":
      return "pending"
    case "input-available":
      return "running"
    case "approval-requested":
      return "awaiting approval"
    case "approval-responded":
      return "responded"
    case "output-available":
      return "completed"
    case "output-error":
      return "error"
    case "output-denied":
      return "denied"
  }
}

function formatEditFileMetaItems(
  item: WorkbenchTimelineToolItem,
  data: Record<string, unknown> | undefined,
  diff: Record<string, unknown> | undefined
): string[] {
  const replacements = getNumber(data?.replacements)
  const additions = getNumber(diff?.additions)
  const deletions = getNumber(diff?.deletions)
  const metaItems = [formatToolStatusLabel(item.status)]

  if (replacements !== undefined) {
    metaItems.push(`${replacements} replacement${replacements === 1 ? "" : "s"}`)
  }
  if (additions !== undefined || deletions !== undefined) {
    metaItems.push(`+${additions ?? 0} -${deletions ?? 0}`)
  }
  if (diff?.truncated === true) {
    metaItems.push("preview")
  }

  return metaItems
}

function formatBashTerminalOutput({
  command,
  cwd,
  errorText,
  stderr,
  stderrCharacters,
  stderrTruncated,
  stdout,
  stdoutCharacters,
  stdoutTruncated,
}: {
  command?: string
  cwd: string
  errorText?: string
  stderr: string
  stderrCharacters: number
  stderrTruncated: boolean
  stdout: string
  stdoutCharacters: number
  stdoutTruncated: boolean
}): string {
  const sections: string[] = []

  if (command) {
    sections.push(`${cwd} $ ${command}`)
  }
  if (errorText) {
    sections.push(`error: ${errorText}`)
  }
  if (stdout) {
    sections.push(trimTrailingLineBreaks(stdout))
  }
  if (stderr) {
    sections.push(
      [
        `[stderr${formatOutputPreviewLabel(stderrCharacters, stderrTruncated)}]`,
        trimTrailingLineBreaks(stderr),
      ].join("\n")
    )
  }
  if (stdoutTruncated || stderrTruncated) {
    sections.push(
      [
        "[preview truncated]",
        `stdout: ${stdoutCharacters} chars${stdoutTruncated ? ", preview" : ""}`,
        `stderr: ${stderrCharacters} chars${stderrTruncated ? ", preview" : ""}`,
      ].join("\n")
    )
  }

  return sections.filter(Boolean).join("\n\n")
}

function formatOutputPreviewLabel(characters: number, truncated: boolean): string {
  return `, ${characters} chars${truncated ? ", preview" : ""}`
}

function trimTrailingLineBreaks(text: string): string {
  return text.replace(/(?:\r?\n)+$/, "")
}

function PermissionBlockView({ item }: { item: WorkbenchTimelinePermissionItem }) {
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null)
  const [submitted, setSubmitted] = useState<"approve" | "deny" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sourceLabel = item.externalProvider === "opencode"
    ? "OpenCode"
    : item.externalProvider
  const approval: NonNullable<ConfirmationProps["approval"]> =
    item.approved === undefined
      ? { id: item.requestId }
      : { id: item.requestId, approved: item.approved }
  const isPending = item.status === "approval-requested" && item.approved === undefined
  const actionsDisabled = submitting !== null || (isPending && submitted !== null)

  const decidePermission = useCallback(async (approved: boolean) => {
    setSubmitting(approved ? "approve" : "deny")
    setError(null)
    try {
      await conversationMessagesApi.decidePermission(item.runId, item.requestId, {
        approved,
        reason: approved ? "Approved from AgentHub UI." : "Denied from AgentHub UI.",
      })
      setSubmitted(approved ? "approve" : "deny")
    } catch (err) {
      setSubmitted(null)
      setError(err instanceof Error ? err.message : "Permission decision failed")
    } finally {
      setSubmitting(null)
    }
  }, [item.requestId, item.runId])

  return (
    <Confirmation
      approval={approval}
      className="min-w-0 max-w-[min(720px,100%)]"
      state={item.status}
    >
      <ConfirmationTitle>
        <ConfirmationRequest>
          {item.title}
          {item.reason ? `: ${item.reason}` : ""}
        </ConfirmationRequest>
        <ConfirmationAccepted>
          Permission approved for {item.toolName ?? "tool"}.
        </ConfirmationAccepted>
        <ConfirmationRejected>
          Permission denied for {item.toolName ?? "tool"}.
        </ConfirmationRejected>
      </ConfirmationTitle>
      {sourceLabel || item.target ? (
        <div className="min-w-0 break-words text-muted-foreground text-xs">
          {sourceLabel ? `来源：${sourceLabel}` : null}
          {sourceLabel && item.target ? " · " : null}
          {item.target ? `目标：${item.target}` : null}
        </div>
      ) : null}
      {item.details?.length ? (
        <div className="grid min-w-0 gap-1 rounded-md border bg-background/70 p-2 text-xs">
          {item.details.map((detail) => (
            <div
              className="grid min-w-0 gap-1 sm:grid-cols-[5rem_minmax(0,1fr)]"
              key={`${detail.label}:${detail.value}`}
            >
              <div className="shrink-0 text-muted-foreground">{detail.label}</div>
              {detail.code ? (
                <code className="block min-w-0 overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
                  {detail.value}
                </code>
              ) : (
                <div className="min-w-0 break-words text-foreground">
                  {detail.value}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}
      <ConfirmationActions>
        <ConfirmationAction
          aria-label="Deny permission"
          disabled={actionsDisabled}
          onClick={() => void decidePermission(false)}
          variant="destructive"
        >
          {submitting === "deny" ? (
            <Loader2Icon data-icon="inline-start" className="animate-spin" />
          ) : (
            <XCircleIcon data-icon="inline-start" />
          )}
          Deny
        </ConfirmationAction>
        <ConfirmationAction
          aria-label="Approve permission"
          disabled={actionsDisabled}
          onClick={() => void decidePermission(true)}
        >
          {submitting === "approve" ? (
            <Loader2Icon data-icon="inline-start" className="animate-spin" />
          ) : (
            <CheckIcon data-icon="inline-start" />
          )}
          Approve
        </ConfirmationAction>
      </ConfirmationActions>
      {error ? (
        <div className="text-destructive text-xs">{error}</div>
      ) : null}
    </Confirmation>
  )
}

function QuestionBlockView({ item }: { item: WorkbenchTimelineQuestionItem }) {
  const answered = item.status === "answered"
  const cancelled = item.status === "cancelled"

  return (
    <Card className="max-w-[min(720px,100%)] border bg-muted/20" size="sm">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate">{item.title}</CardTitle>
            <CardDescription>
              {item.questions.length} question{item.questions.length === 1 ? "" : "s"} from {item.agentId ?? "agent"}
            </CardDescription>
          </div>
          <QuestionStatusBadge status={item.status} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {item.questions.map((question, index) => {
          const answer = item.answers?.find((candidate) => candidate.questionId === question.id)
          return (
            <div className="flex flex-col gap-2" key={question.id}>
              {index > 0 ? <Separator /> : null}
              <div>
                <div className="text-sm font-medium">{question.title}</div>
                <div className="text-muted-foreground text-sm">{question.body}</div>
              </div>
              {answer ? (
                <div className="rounded-md bg-background px-3 py-2 text-sm">
                  {formatQuestionAnswer(question, answer)}
                </div>
              ) : (
                <div className="text-muted-foreground text-xs">
                  {cancelled ? "No answer submitted." : "Waiting for your answer below."}
                </div>
              )}
            </div>
          )
        })}
        {answered ? (
          <div className="text-muted-foreground text-xs">Answered at {item.time}</div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function QuestionStatusBadge({
  status,
}: {
  status: WorkbenchTimelineQuestionItem["status"]
}) {
  if (status === "answered") {
    return (
      <Badge className="gap-1" variant="secondary">
        <CheckCircleIcon data-icon="inline-start" />
        Answered
      </Badge>
    )
  }
  if (status === "cancelled") {
    return (
      <Badge className="gap-1" variant="outline">
        <XCircleIcon data-icon="inline-start" />
        Cancelled
      </Badge>
    )
  }
  return (
    <Badge className="gap-1" variant="secondary">
      <ClockIcon data-icon="inline-start" />
      Waiting
    </Badge>
  )
}

function formatQuestionAnswer(
  question: WorkbenchTimelineQuestionItem["questions"][number],
  answer: NonNullable<WorkbenchTimelineQuestionItem["answers"]>[number]
): string {
  if (answer.custom) {
    return answer.answer ?? "Custom answer"
  }
  const option = question.options.find((candidate) => candidate.id === answer.optionId)
  return answer.answer ?? option?.label ?? answer.optionId ?? "Selected option"
}

function ReasoningBlockView({
  block,
}: {
  block: {
    duration?: number
    status: "streaming" | "completed"
    text: string
  }
}) {
  return (
    <Reasoning
      className="max-w-[min(720px,100%)]"
      duration={block.duration}
      isStreaming={block.status === "streaming"}
    >
      <ReasoningTrigger />
      <ReasoningContent>{block.text}</ReasoningContent>
    </Reasoning>
  )
}

function RunStatusTimelineItem({
  item,
}: {
  item: WorkbenchTimelineRunStatusItem
}) {
  const failed = item.status === "failed"

  return (
    <TimelineCard>
      <div className="flex max-w-[min(720px,100%)] items-start gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
        {failed ? (
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
        ) : (
          <XCircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <div className={failed ? "text-destructive" : "text-muted-foreground"}>
            {item.error ?? item.text}
          </div>
          <div className="mt-1 text-muted-foreground text-xs">{item.time}</div>
        </div>
      </div>
    </TimelineCard>
  )
}

function AgentHeader({
  agent,
  time,
}: {
  agent: ConversationAgentProfile
  time: string
}) {
  const override = useAgentOverride(agent.id)
  return (
    <div className="flex items-center gap-2">
      <AgentAvatar agent={agent} override={override} />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{agent.name}</div>
        <div className="text-muted-foreground text-xs">{time}</div>
      </div>
    </div>
  )
}

function TimelineCard({ children }: { children: ReactNode }) {
  return <div className="flex w-full justify-start">{children}</div>
}

function TimelineStatusBadge({
  status,
}: {
  status: WorkbenchTimelineTaskItem["status"]
}) {
  if (status === "completed") {
    return (
      <Badge className="gap-1" variant="secondary">
        <CheckCircleIcon data-icon="inline-start" />
        Done
      </Badge>
    )
  }
  if (status === "failed") {
    return (
      <Badge className="gap-1" variant="destructive">
        <XCircleIcon data-icon="inline-start" />
        Failed
      </Badge>
    )
  }
  if (status === "running") {
    return (
      <Badge className="gap-1" variant="secondary">
        <ClockIcon data-icon="inline-start" />
        Running
      </Badge>
    )
  }
  return <Badge variant="outline">Pending</Badge>
}

function resolveAgentProfile(
  agentProfiles: ConversationAgentProfile[],
  agentId?: string
): ConversationAgentProfile {
  const matched = agentProfiles.find((agent) => agent.id === agentId)
  if (matched) return matched

  const fallbackName = agentId ?? "Assistant"
  return {
    id: fallbackName,
    name: fallbackName,
    shortName: fallbackName.slice(0, 2).toUpperCase(),
    role: "member",
    capabilities: [],
  }
}

function getChatDisplayContent(
  item: WorkbenchTimelineChatMessageItem,
  content: string
): string {
  if (item.status === "failed") {
    return item.error ?? content
  }
  if (item.status === "cancelled" && !content) {
    return "Run cancelled."
  }
  return content
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function formatUnknown(value: unknown): string {
  if (typeof value === "number") return String(value)
  if (typeof value === "string") return value
  if (value === null) return "null"
  return "-"
}

function formatDurationMs(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}ms`
    : "-"
}
