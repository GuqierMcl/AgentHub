import {
  CheckCircleIcon,
  CircleAlertIcon,
  ClockIcon,
  CopyIcon,
  RefreshCcwIcon,
  XCircleIcon,
} from "lucide-react"
import type { ReactNode } from "react"

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
  Plan,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from "@/components/ai-elements/plan"
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
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation"
import { Badge } from "@/components/ui/badge"
import type { ToolUIPart } from "ai"

import type {
  ConversationAgentProfile,
  WorkbenchTimelineChatMessageItem,
  WorkbenchTimelineItem,
  WorkbenchTimelinePermissionItem,
  WorkbenchTimelinePlanItem,
  WorkbenchTimelineReasoningItem,
  WorkbenchTimelineRunStatusItem,
  WorkbenchTimelineTaskItem,
  WorkbenchTimelineToolItem,
} from "../types"
import { AgentAvatar } from "./AgentAvatar"
import { ArtifactPreview } from "./ArtifactPreview"

type TimelineItemProps = {
  item: WorkbenchTimelineItem
  agentProfiles: ConversationAgentProfile[]
}

export function TimelineItem({ agentProfiles, item }: TimelineItemProps) {
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
      return <PlanTimelineItem item={item} />
    case "run_status":
      return <RunStatusTimelineItem item={item} />
  }
}

function ChatMessageItem({
  agentProfiles,
  item,
}: {
  item: WorkbenchTimelineChatMessageItem
  agentProfiles: ConversationAgentProfile[]
}) {
  const agent = resolveAgentProfile(agentProfiles, item.agentId)
  const versions = item.versions?.length
    ? item.versions
    : [{ content: item.text, id: `${item.id}-default` }]

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

              <MessageContent className="max-w-[min(680px,100%)]">
                <MessageResponse>
                  {getChatDisplayContent(item, version.content)}
                </MessageResponse>
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
                <MessageAction label="Copy message" tooltip="Copy">
                  <CopyIcon />
                </MessageAction>
                {item.role === "assistant" ? (
                  <MessageAction
                    label="Regenerate response"
                    tooltip="Regenerate"
                  >
                    <RefreshCcwIcon />
                  </MessageAction>
                ) : null}
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
      <Tool className="mb-0 max-w-[min(720px,100%)]" defaultOpen>
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
          {item.error ? (
            <TaskItem className="text-destructive">{item.error}</TaskItem>
          ) : null}
        </TaskContent>
      </Task>
    </TimelineCard>
  )
}

function PlanTimelineItem({ item }: { item: WorkbenchTimelinePlanItem }) {
  return (
    <TimelineCard>
      <Plan className="max-w-[min(720px,100%)]" defaultOpen>
        <PlanHeader>
          <div className="min-w-0">
            <PlanTitle>{item.title}</PlanTitle>
            <PlanDescription>{item.description}</PlanDescription>
          </div>
          <PlanTrigger />
        </PlanHeader>
        <PlanContent>
          <div className="space-y-2 text-sm">
            {item.tasks.length ? (
              item.tasks.map((task) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                  key={task.taskId}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{task.title}</div>
                    {task.targetAgentId ? (
                      <div className="text-muted-foreground text-xs">
                        {task.targetAgentId}
                      </div>
                    ) : null}
                  </div>
                  {task.status ? (
                    <Badge className="shrink-0" variant="secondary">
                      {task.status}
                    </Badge>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="text-muted-foreground">Plan updated.</div>
            )}
          </div>
        </PlanContent>
      </Plan>
    </TimelineCard>
  )
}

function PermissionTimelineItem({
  item,
}: {
  item: WorkbenchTimelinePermissionItem
}) {
  const approval =
    item.approved === undefined
      ? { id: item.requestId }
      : { id: item.requestId, approved: item.approved }

  return (
    <TimelineCard>
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
      </Confirmation>
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
      <Reasoning
        className="max-w-[min(720px,100%)]"
        isStreaming={item.status === "streaming"}
      >
        <ReasoningTrigger />
        <ReasoningContent>{item.text}</ReasoningContent>
      </Reasoning>
    </TimelineCard>
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
  if (item.status === "streaming" && !content) {
    return "正在生成..."
  }
  return content
}
