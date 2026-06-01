import type { TextStreamPart, ToolSet } from "ai"
import { createRunEvent } from "./run-events"
import { withRuntimeGenerationData, type RuntimeGeneration } from "./generation"
import type { AgentExecutionContext, RunEvent } from "./types"

type TextBlockPart = Extract<TextStreamPart<ToolSet>, {
  type: "text-start" | "text-delta" | "text-end"
}>

type MessageBlockState = {
  messageId: string
  content: string
}

export class MessageBlockIdentityTracker {
  private readonly messageIdsByTextId = new Map<string, string>()
  private readonly messageIdsByReasoningId = new Map<string, string>()
  private fallbackBlockIndex = 0
  private pendingMessageId: string | undefined

  constructor(private readonly context: AgentExecutionContext) {}

  getOrCreateCurrentMessageId(): string {
    if (!this.pendingMessageId) {
      this.pendingMessageId = this.createMessageId()
    }
    return this.pendingMessageId
  }

  getOrCreateTextMessageId(textId: string): string {
    const current = this.messageIdsByTextId.get(textId)
    if (current) {
      return current
    }

    const messageId = this.pendingMessageId ?? this.createMessageId()
    this.pendingMessageId = undefined
    this.messageIdsByTextId.set(textId, messageId)
    return messageId
  }

  completeTextBlock(textId: string): void {
    this.messageIdsByTextId.delete(textId)
  }

  getOrCreateReasoningMessageId(reasoningId: string): string {
    const current = this.messageIdsByReasoningId.get(reasoningId)
    if (current) {
      return current
    }

    const messageId = this.getOrCreateCurrentMessageId()
    this.messageIdsByReasoningId.set(reasoningId, messageId)
    return messageId
  }

  completeReasoningBlock(reasoningId: string): void {
    this.messageIdsByReasoningId.delete(reasoningId)
  }

  consumePendingOrCreateMessageId(): string {
    const messageId = this.pendingMessageId ?? this.createMessageId()
    this.pendingMessageId = undefined
    return messageId
  }

  resetCurrentMessageId(): void {
    this.pendingMessageId = undefined
  }

  private createMessageId(): string {
    if (this.context.createMessageId) {
      return this.context.createMessageId()
    }

    const executionId = this.context.executionId ?? "execution"
    const blockIndex = this.fallbackBlockIndex
    this.fallbackBlockIndex += 1
    return `msg_${this.context.runId}_${executionId}_${blockIndex}`
  }
}

export class MessageBlockEventBuilder {
  private readonly blocksByTextId = new Map<string, MessageBlockState>()
  private emittedMessageEvent = false

  constructor(
    private readonly context: AgentExecutionContext,
    private readonly identityTracker = new MessageBlockIdentityTracker(context),
    private readonly baseGeneration?: RuntimeGeneration
  ) {}

  createEvents(part: TextStreamPart<ToolSet>): RunEvent[] {
    if (!isTextBlockPart(part)) {
      return []
    }

    if (part.type === "text-start") {
      this.getOrCreateBlock(part.id)
      return []
    }

    if (part.type === "text-delta") {
      if (!part.text) {
        return []
      }

      const block = this.getOrCreateBlock(part.id)
      block.content += part.text
      return [this.createMessageEvent("message.delta", block, {
        delta: part.text,
      })]
    }

    const block = this.getOrCreateBlock(part.id)
    this.identityTracker.completeTextBlock(part.id)
    this.blocksByTextId.delete(part.id)
    return [this.createMessageEvent("message.completed", block, {
      content: block.content,
    })]
  }

  flushOpenBlocks(): RunEvent[] {
    const events: RunEvent[] = []
    for (const [textId, block] of this.blocksByTextId) {
      events.push(this.createMessageEvent("message.completed", block, {
        content: block.content,
      }))
      this.blocksByTextId.delete(textId)
    }
    return events
  }

  createCompletedFallback(content: string): RunEvent | null {
    if (!content) {
      return null
    }

    const block = {
      messageId: this.identityTracker.consumePendingOrCreateMessageId(),
      content,
    }
    return this.createMessageEvent("message.completed", block, {
      content,
    })
  }

  hasEmittedMessage(): boolean {
    return this.emittedMessageEvent
  }

  private getOrCreateBlock(textId: string): MessageBlockState {
    const current = this.blocksByTextId.get(textId)
    if (current) {
      return current
    }

    const block = {
      messageId: this.identityTracker.getOrCreateTextMessageId(textId),
      content: "",
    }
    this.blocksByTextId.set(textId, block)
    return block
  }

  private createMessageEvent(
    type: "message.delta" | "message.completed",
    block: MessageBlockState,
    data: unknown
  ): RunEvent {
    const event = createRunEvent(
      this.context.runId,
      type,
      this.context.agent.id,
      withRuntimeGenerationData(data, this.baseGeneration)
    )
    event.messageId = block.messageId
    event.taskId = this.context.task?.taskId
    event.parentAgentId = this.context.parentAgentId
    event.parentTaskId = this.context.parentTaskId
    event.groupId = this.context.groupId
    this.emittedMessageEvent = true
    return event
  }

}

function isTextBlockPart(part: TextStreamPart<ToolSet>): part is TextBlockPart {
  return part.type === "text-start" ||
    part.type === "text-delta" ||
    part.type === "text-end"
}
