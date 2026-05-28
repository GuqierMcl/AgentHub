import { CopyIcon, RefreshCcwIcon } from "lucide-react"

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
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool"

import { getAgentById } from "../mock-data"
import type { WorkbenchMessage } from "../types"
import { AgentAvatar } from "./AgentAvatar"
import { ArtifactPreview } from "./ArtifactPreview"

type MessageItemProps = {
  message: WorkbenchMessage
}

export function MessageItem({ message }: MessageItemProps) {
  const agent = getAgentById(message.agentId)
  const fallbackAgentName = message.agentId ?? "Assistant"
  const versions = message.versions?.length
    ? message.versions
    : [{ content: message.text, id: `${message.id}-default` }]

  return (
    <MessageBranch defaultBranch={0}>
      <MessageBranchContent>
        {versions.map((version) => (
          <Message from={message.role} key={version.id}>
            <div className="flex max-w-full flex-col gap-2">
              {message.role === "assistant" && agent ? (
                <div className="flex items-center gap-2">
                  <AgentAvatar agent={agent} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {agent.name}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {message.time}
                    </div>
                  </div>
                </div>
              ) : message.role === "assistant" ? (
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground text-xs">
                    {fallbackAgentName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {fallbackAgentName}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {message.time}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-right text-muted-foreground text-xs">
                  {message.time}
                </div>
              )}

              {message.sources?.length ? (
                <Sources>
                  <SourcesTrigger count={message.sources.length} />
                  <SourcesContent>
                    {message.sources.map((source) => (
                      <Source
                        href={source.href}
                        key={source.href}
                        title={source.title}
                      />
                    ))}
                  </SourcesContent>
                </Sources>
              ) : null}

              {message.reasoning ? (
                <Reasoning duration={message.reasoning.duration}>
                  <ReasoningTrigger />
                  <ReasoningContent>
                    {message.reasoning.content}
                  </ReasoningContent>
                </Reasoning>
              ) : null}

              {message.tools?.map((tool) => (
                <Tool className="max-w-[min(680px,100%)]" key={tool.id}>
                  <ToolHeader
                    state={tool.status}
                    title={tool.description}
                    type={`tool-${tool.name}`}
                  />
                  <ToolContent>
                    <ToolInput input={tool.parameters} />
                    <ToolOutput errorText={tool.error} output={tool.result} />
                  </ToolContent>
                </Tool>
              ))}

              <MessageContent className="max-w-[min(680px,100%)]">
                <MessageResponse>
                  {getMessageDisplayContent(message, version.content)}
                </MessageResponse>
                {message.artifacts?.length ? (
                  <div className="mt-3 flex flex-col gap-2">
                    {message.artifacts.map((artifact) => (
                      <ArtifactPreview
                        artifact={artifact}
                        key={artifact.id}
                      />
                    ))}
                  </div>
                ) : null}
              </MessageContent>

              <MessageActions
                className={message.role === "user" ? "justify-end" : undefined}
              >
                <MessageAction label="Copy message" tooltip="Copy">
                  <CopyIcon />
                </MessageAction>
                {message.role === "assistant" ? (
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

function getMessageDisplayContent(
  message: WorkbenchMessage,
  content: string
): string {
  if (message.status === "failed") {
    return message.error ?? content
  }
  if (message.status === "cancelled" && !content) {
    return "Run cancelled."
  }
  if (message.status === "streaming" && !content) {
    return "正在生成..."
  }
  return content
}
