import {
  CheckCircleIcon,
  CheckIcon,
  CircleAlertIcon,
  ClockIcon,
  Loader2Icon,
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
import type { ToolUIPart } from "ai"

import type {
  ConversationAgentProfile,
  WorkbenchTimelineChatMessageItem,
  WorkbenchTimelineItem,
  WorkbenchTimelinePermissionItem,
  WorkbenchTimelineReasoningItem,
  WorkbenchTimelineRunStatusItem,
  WorkbenchTimelineTaskItem,
  WorkbenchTimelineToolItem,
} from "../types"
import { conversationMessagesApi } from "../api/messages"
import { AgentAvatar } from "./AgentAvatar"
import { ArtifactPreview } from "./ArtifactPreview"

type TimelineItemProps = {
  item: WorkbenchTimelineItem
  agentProfiles: ConversationAgentProfile[]
}

export const TimelineItem = memo(function TimelineItem({
  agentProfiles,
  item,
}: TimelineItemProps) {
  switch (item.kind) {
    case "chat_message":
      return <ChatMessageItem agentProfiles={agentProfiles} item={item} />
    case "task":
      return <TaskTimelineItem item={item} />
    case "tool":
      return <ToolTimelineItem item={item} />
    case "permission":
      return <PermissionTimelineItem item={item} />
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
}: {
  item: WorkbenchTimelineChatMessageItem
  agentProfiles: ConversationAgentProfile[]
}) {
  const agent = resolveAgentProfile(agentProfiles, item.agentId)
  const versions = useMemo(
    () =>
      item.versions?.length
        ? item.versions
        : [{ content: item.text, id: `${item.id}-default` }],
    [item.id, item.text, item.versions]
  )

  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    const text = versions.map((v) => v.content).join("\n")
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [versions])

  return (
    <MessageBranch defaultBranch={0}>
      <MessageBranchContent>
        {versions.map((version) => (
          <Message from={item.role} key={version.id}>
            <div className="flex max-w-full flex-col gap-2">
              {item.role === "assistant" ? (
                <AgentHeader agent={agent} time={item.time} />
              ) : (
                <div className="text-right text-muted-foreground text-xs">
                  {item.time}
                </div>
              )}

              {item.sources?.length ? (
                <Sources>
                  <SourcesTrigger count={item.sources.length} />
                  <SourcesContent>
                    {item.sources.map((source) => (
                      <Source
                        href={source.href}
                        key={source.href}
                        title={source.title}
                      />
                    ))}
                  </SourcesContent>
                </Sources>
              ) : null}

              {item.reasoningBlocks?.map((reasoning) => (
                <ReasoningBlockView
                  block={reasoning}
                  key={`${reasoning.messageId ?? item.id}:${reasoning.reasoningId}`}
                />
              ))}

              {item.permissionItems?.map((permission) => (
                <PermissionBlockView item={permission} key={permission.id} />
              ))}

              {item.toolItems?.map((tool) => (
                <ToolBlockView item={tool} key={tool.id} />
              ))}

              <MessageContent className="max-w-[min(680px,100%)]">
                <MessageResponse>
                  {getChatDisplayContent(item, version.content)}
                </MessageResponse>
                {item.role !== "user" && item.status === "streaming" ? (
                  <div className="mt-2 flex items-center gap-2 text-muted-foreground text-xs">
                    <Loader2Icon className="size-3.5 animate-spin" />
                    <span>正在生成...</span>
                  </div>
                ) : null}
                {item.artifacts?.length ? (
                  <div className="mt-3 flex flex-col gap-2">
                    {item.artifacts.map((artifact) => (
                      <ArtifactPreview artifact={artifact} key={artifact.id} />
                    ))}
                  </div>
                ) : null}
              </MessageContent>

              <MessageActions
                className={item.role === "user" ? "justify-end" : undefined}
              >
                <MessageAction label="Copy message" tooltip={copied ? "Copied!" : "Copy"} onClick={handleCopy}>
                  {copied ? <CheckIcon /> : <CopyIcon className="![&_svg]:size-4" size={16} />}
                </MessageAction>
              </MessageActions>
            </div>
          </Message>
        ))}
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
          {item.reasoningBlocks?.map((reasoning) => (
            <TaskItem key={`${reasoning.messageId ?? item.id}:${reasoning.reasoningId}`}>
              <ReasoningBlockView block={reasoning} />
            </TaskItem>
          ))}
          {item.permissionItems?.map((permission) => (
            <TaskItem key={permission.id}>
              <PermissionBlockView item={permission} />
            </TaskItem>
          ))}
          {item.toolItems?.map((tool) => (
            <TaskItem key={tool.id}>
              <ToolBlockView item={tool} />
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
  return (
    <Tool className="mb-0 max-w-[min(720px,100%)]" defaultOpen={false} >
      <ToolHeader
        state={item.status}
        title={item.title}
        type={`tool-${item.toolName}` as ToolUIPart["type"]}
      />
      <ToolContent>
        {item.input !== undefined ? <ToolInput input={item.input} /> : null}
        {item.toolName === "bash" ? (
          <BashToolOutputView errorText={item.errorText} output={item.output} />
        ) : (
          <ToolOutput errorText={item.errorText} output={item.output} />
        )}
      </ToolContent>
    </Tool>
  )
}

function BashToolOutputView({
  errorText,
  output,
}: {
  output: WorkbenchTimelineToolItem["output"]
  errorText: WorkbenchTimelineToolItem["errorText"]
}) {
  const data = getRecord(output)
  if (!data) {
    return <ToolOutput errorText={errorText} output={output} />
  }

  const stdout = getString(data.stdout) ?? ""
  const stderr = getString(data.stderr) ?? ""
  const stdoutCharacters = getNumber(data.stdoutCharacters) ?? stdout.length
  const stderrCharacters = getNumber(data.stderrCharacters) ?? stderr.length
  const hasOutput = stdout.length > 0 || stderr.length > 0 || errorText

  if (!hasOutput) {
    return null
  }

  return (
    <div className="space-y-3">
      <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      {errorText ? (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs">
          {errorText}
        </div>
      ) : null}
      <div className="grid gap-2 rounded-md bg-muted/50 p-3 text-xs sm:grid-cols-2">
        <BashMeta label="Command" value={getString(data.command)} wide />
        <BashMeta label="cwd" value={getString(data.cwd) ?? "."} />
        <BashMeta label="Exit" value={formatUnknown(data.exitCode)} />
        <BashMeta label="Duration" value={formatDurationMs(data.durationMs)} />
        <BashMeta label="Truncated" value={data.truncated ? "yes" : "no"} />
      </div>
      {stdout ? (
        <BashStreamBlock
          characters={stdoutCharacters}
          label="stdout"
          text={stdout}
          truncated={data.stdoutTruncatedForDisplay === true || data.stdoutTruncatedForUi === true}
        />
      ) : null}
      {stderr ? (
        <BashStreamBlock
          characters={stderrCharacters}
          label="stderr"
          text={stderr}
          truncated={data.stderrTruncatedForDisplay === true || data.stderrTruncatedForUi === true}
        />
      ) : null}
    </div>
  )
}

function BashMeta({
  label,
  value,
  wide,
}: {
  label: string
  value?: string
  wide?: boolean
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words font-mono text-foreground">{value ?? "-"}</div>
    </div>
  )
}

function BashStreamBlock({
  characters,
  label,
  text,
  truncated,
}: {
  characters: number
  label: string
  text: string
  truncated: boolean
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
        <span className="font-medium uppercase tracking-wide">{label}</span>
        <span>{characters} chars{truncated ? " · preview" : ""}</span>
      </div>
      <pre className="max-h-72 overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
        {text}
      </pre>
    </div>
  )
}

function PermissionBlockView({ item }: { item: WorkbenchTimelinePermissionItem }) {
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null)
  const [submitted, setSubmitted] = useState<"approve" | "deny" | null>(null)
  const [error, setError] = useState<string | null>(null)
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
      className="max-w-[min(720px,100%)]"
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
  return (
    <div className="flex items-center gap-2">
      <AgentAvatar agent={agent} />
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
