import { createChildLogger } from "../../logger"
import { createRunEvent } from "../run-events"
import type { ExternalContextPacket, RunEvent } from "../types"
import type { OpenCodeClient, OpenCodeExecutionAgent, OpenCodePermissionRequest } from "./opencode-client"
import { createDefaultOpenCodeClient } from "./opencode-real-client"
import {
  ExternalAdapterError,
  assertNoImagePartsForExternalAdapter,
  type ExternalAdapterContext,
  type ExternalAdapterPrompt,
  type ExternalAgentAdapter,
} from "./types"

const log = createChildLogger("opencode-adapter")
const DEFAULT_OPENCODE_EXECUTION_AGENT: OpenCodeExecutionAgent = "build"

export class OpenCodeAdapter implements ExternalAgentAdapter {
  provider = "opencode" as const

  constructor(private client: OpenCodeClient = createDefaultOpenCodeClient()) {}

  async *execute(context: ExternalAdapterContext): AsyncIterable<RunEvent> {
    assertNoImagePartsForExternalAdapter(context, this.provider)

    const sessionHint = context.input.externalSessionHints?.find((hint) => {
      return hint.provider === this.provider &&
        hint.agentId === context.agent.id &&
        hint.scope === context.scope &&
        (!hint.workspaceId || hint.workspaceId === context.workspace.workspaceId) &&
        (!context.task?.taskId || hint.taskId === undefined || hint.taskId === context.task.taskId)
    })
    const externalContext = this.resolveExternalContext(context)

    log.info(
      {
        externalProvider: this.provider,
        runId: context.runId,
        conversationId: context.input.conversationId,
        agentId: context.agent.id,
        scope: context.scope,
        workspaceId: context.workspace.workspaceId,
        workspaceRootPath: context.workspace.rootPath,
        taskId: context.task?.taskId,
        parentAgentId: context.parentAgentId,
        groupId: context.groupId,
        hasSessionHint: Boolean(sessionHint),
        hintedProviderSessionId: sessionHint?.providerSessionId,
        externalContextMode: externalContext?.mode,
        externalContextMessageCount: externalContext?.messages.length ?? 0,
        externalContextHandoffCount: externalContext?.handoffSummaries.length ?? 0,
      },
      "OpenCode adapter execution starting"
    )
    const session = await this.client.ensureSession({
      runId: context.runId,
      conversationId: context.input.conversationId,
      agentId: context.agent.id,
      scope: context.scope,
      workspaceId: context.workspace.workspaceId,
      workspaceRootPath: context.workspace.rootPath,
      taskId: context.task?.taskId,
      providerSessionId: sessionHint?.providerSessionId,
      handoffSummary: sessionHint?.handoffSummary,
    })
    log.info(
      {
        externalProvider: this.provider,
        runId: context.runId,
        conversationId: context.input.conversationId,
        agentId: context.agent.id,
        scope: context.scope,
        workspaceId: context.workspace.workspaceId,
        taskId: context.task?.taskId,
        providerSessionId: session.providerSessionId,
        reusedHint: Boolean(sessionHint && sessionHint.providerSessionId === session.providerSessionId),
      },
      "OpenCode adapter session ready"
    )

    const started = createRunEvent(context.runId, "agent.started", context.agent.id, {
      agentName: context.agent.name,
      executorType: context.agent.executorType,
      externalProvider: this.provider,
      externalSession: session,
    })
    started.taskId = context.task?.taskId
    started.parentAgentId = context.parentAgentId
    started.parentTaskId = context.parentTaskId
    started.groupId = context.groupId
    yield started

    const prompt = this.buildPrompt(context, externalContext)
    const executionAgent = this.resolveExecutionAgent(context)
    const model = this.resolveModelOverride(context)
    const messageId = context.createMessageId?.()
    log.info(
      {
        externalProvider: this.provider,
        runId: context.runId,
        conversationId: context.input.conversationId,
        agentId: context.agent.id,
        scope: context.scope,
        taskId: context.task?.taskId,
        providerSessionId: session.providerSessionId,
        messageId,
        executionAgent,
        modelProviderId: model?.providerID,
        modelId: model?.modelID,
        promptLength: prompt.content.length,
        externalContextMode: prompt.externalContext?.mode,
        externalContextMessageCount: prompt.externalContext?.messages.length ?? 0,
        externalContextHandoffCount: prompt.externalContext?.handoffSummaries.length ?? 0,
      },
      "OpenCode adapter prompt dispatching"
    )

    let completedContent = ""
    for await (const chunk of this.client.streamPrompt({
      session,
      prompt,
      executionAgent,
      model,
      signal: context.signal,
      permissionHandler: (request) => this.handlePermissionRequest(context, session.providerSessionId, messageId, request),
    })) {
      if (context.signal.aborted) {
        log.info(
          {
            externalProvider: this.provider,
            runId: context.runId,
            conversationId: context.input.conversationId,
            agentId: context.agent.id,
            scope: context.scope,
            taskId: context.task?.taskId,
            providerSessionId: session.providerSessionId,
          },
          "OpenCode adapter execution aborted during prompt stream"
        )
        return
      }

      const event = (() => {
        switch (chunk.type) {
          case "message.delta":
            return createRunEvent(context.runId, "message.delta", context.agent.id, {
              delta: chunk.delta,
            })
          case "message.completed":
            completedContent = chunk.content
            return createRunEvent(context.runId, "message.completed", context.agent.id, {
              content: chunk.content,
              ...(chunk.externalModel ? { externalModel: chunk.externalModel } : {}),
            })
          case "reasoning.delta":
            return createRunEvent(context.runId, "reasoning.delta", context.agent.id, {
              reasoningId: chunk.reasoningId,
              delta: chunk.delta,
              externalProvider: this.provider,
              providerSessionId: session.providerSessionId,
            })
          case "reasoning.completed":
            return createRunEvent(context.runId, "reasoning.completed", context.agent.id, {
              reasoningId: chunk.reasoningId,
              content: chunk.content,
              externalProvider: this.provider,
              providerSessionId: session.providerSessionId,
            })
          case "tool.started": {
            const event = createRunEvent(context.runId, "tool.started", context.agent.id, {
              ...this.buildExternalToolData(session.providerSessionId, chunk),
              input: chunk.input,
            })
            event.toolCallId = this.formatExternalToolCallId(chunk.providerToolCallId)
            event.toolName = chunk.providerToolName
            return event
          }
          case "tool.completed": {
            const event = createRunEvent(context.runId, "tool.completed", context.agent.id, {
              ...this.buildExternalToolData(session.providerSessionId, chunk),
              ...(chunk.input !== undefined ? { input: chunk.input } : {}),
              output: chunk.output,
              data: chunk.output,
            })
            event.toolCallId = this.formatExternalToolCallId(chunk.providerToolCallId)
            event.toolName = chunk.providerToolName
            return event
          }
          case "tool.failed": {
            const event = createRunEvent(context.runId, "tool.failed", context.agent.id, {
              ...this.buildExternalToolData(session.providerSessionId, chunk),
              ...(chunk.input !== undefined ? { input: chunk.input } : {}),
              error: chunk.error,
            })
            event.toolCallId = this.formatExternalToolCallId(chunk.providerToolCallId)
            event.toolName = chunk.providerToolName
            return event
          }
          case "permission.requested":
            return undefined
        }
      })()

      if (!event) {
        continue
      }

      event.messageId = messageId
      event.taskId = context.task?.taskId
      event.parentAgentId = context.parentAgentId
      event.parentTaskId = context.parentTaskId
      event.groupId = context.groupId
      yield event
    }

    if (context.signal.aborted) {
      log.info(
        {
          externalProvider: this.provider,
          runId: context.runId,
          conversationId: context.input.conversationId,
          agentId: context.agent.id,
          scope: context.scope,
          taskId: context.task?.taskId,
          providerSessionId: session.providerSessionId,
        },
        "OpenCode adapter execution aborted after prompt stream"
      )
      return
    }

    const handoffSummary = context.task
      ? this.buildHandoffSummary(context, completedContent)
      : undefined
    const completedSession = handoffSummary
      ? { ...session, handoffSummary }
      : session
    const appliedExternalContext = prompt.externalContext
      ? this.summarizeExternalContext(prompt.externalContext)
      : undefined
    const completed = createRunEvent(context.runId, "agent.completed", context.agent.id, {
      status: "completed",
      externalProvider: this.provider,
      externalSession: completedSession,
      ...(appliedExternalContext ? { externalContext: appliedExternalContext } : {}),
      ...(handoffSummary ? { handoffSummary } : {}),
    })
    completed.taskId = context.task?.taskId
    completed.parentAgentId = context.parentAgentId
    completed.parentTaskId = context.parentTaskId
    completed.groupId = context.groupId
    yield completed
    log.info(
      {
        externalProvider: this.provider,
        runId: context.runId,
        conversationId: context.input.conversationId,
        agentId: context.agent.id,
        scope: context.scope,
        taskId: context.task?.taskId,
        providerSessionId: session.providerSessionId,
        executionAgent,
        modelProviderId: model?.providerID,
        modelId: model?.modelID,
        externalContextMode: appliedExternalContext?.mode,
        externalContextMessageCount: appliedExternalContext?.messageCount ?? 0,
        externalContextHandoffCount: appliedExternalContext?.handoffSummaryCount ?? 0,
        handoffSummaryLength: handoffSummary?.length ?? 0,
      },
      "OpenCode adapter execution completed"
    )
  }

  private resolveExecutionAgent(context: ExternalAdapterContext): OpenCodeExecutionAgent {
    return this.resolveOpenCodeSettings(context)?.executionAgent ?? DEFAULT_OPENCODE_EXECUTION_AGENT
  }

  private resolveModelOverride(context: ExternalAdapterContext) {
    return this.resolveOpenCodeSettings(context)?.model
  }

  private resolveOpenCodeSettings(context: ExternalAdapterContext) {
    return context.agent.externalSettings?.provider === "opencode"
      ? context.agent.externalSettings
      : undefined
  }

  private buildExternalToolData(
    providerSessionId: string,
    chunk: {
      providerEventId?: string
      providerToolCallId: string
      providerToolName: string
      providerExecuted?: boolean
      providerMetadata?: Record<string, unknown>
    }
  ): Record<string, unknown> {
    return {
      summary: `OpenCode · ${chunk.providerToolName}`,
      externalProvider: this.provider,
      providerSessionId,
      providerEventId: chunk.providerEventId,
      providerToolCallId: chunk.providerToolCallId,
      providerToolName: chunk.providerToolName,
      providerExecuted: chunk.providerExecuted,
      providerMetadata: chunk.providerMetadata,
    }
  }

  private async handlePermissionRequest(
    context: ExternalAdapterContext,
    providerSessionId: string,
    messageId: string | undefined,
    request: OpenCodePermissionRequest
  ): Promise<{ approved: boolean; reason?: string }> {
    if (!context.permissionService || !context.emitEvent) {
      throw new ExternalAdapterError(
        "ADAPTER_PERMISSION_FAILED",
        "OpenCode permission bridge is not available",
        { provider: this.provider }
      )
    }

    const toolCallId = this.formatExternalToolCallId(
      request.providerToolCallId ?? `permission:${request.providerPermissionId}`
    )
    const permissionType = this.mapPermissionType(request.permissionKind)
    const decision = await context.permissionService.stageExternalApproval({
      runId: context.runId,
      agentId: context.agent.id,
      toolCallId,
      toolName: request.permissionKind,
      riskLevel: this.mapPermissionRiskLevel(request.permissionKind),
      reason: request.reason ?? `OpenCode requested ${request.permissionKind} permission`,
      executionId: context.executionId,
      messageId,
      parentAgentId: context.parentAgentId,
      taskId: context.task?.taskId,
      groupId: context.groupId,
      parentTaskId: context.parentTaskId,
      data: {
        externalProvider: this.provider,
        providerSessionId,
        providerPermissionId: request.providerPermissionId,
        permissionKind: request.permissionKind,
        permissionType,
        patterns: request.patterns,
        always: request.always,
        providerToolCallId: request.providerToolCallId,
        providerMessageId: request.providerMessageId,
        providerMetadata: request.providerMetadata,
      },
    }, context.emitEvent)

    return decision
  }

  private mapPermissionRiskLevel(permissionKind: string): "low" | "medium" | "high" {
    switch (permissionKind) {
      case "edit":
      case "bash":
      case "repo_clone":
        return "high"
      case "read":
      case "list":
      case "glob":
      case "grep":
        return "low"
      default:
        return "medium"
    }
  }

  private mapPermissionType(permissionKind: string): string {
    switch (permissionKind) {
      case "edit":
        return "file_write"
      case "read":
      case "list":
      case "glob":
      case "grep":
        return "file_read"
      case "webfetch":
      case "websearch":
        return "network_access"
      case "bash":
      default:
        return "command_execute"
    }
  }

  private formatExternalToolCallId(providerToolCallId: string): string {
    return `opencode:${providerToolCallId}`
  }

  private buildPrompt(
    context: ExternalAdapterContext,
    externalContext?: ExternalContextPacket
  ): ExternalAdapterPrompt {
    if (context.task) {
      return {
        scope: context.scope,
        task: context.task,
        content: [
          `Task title: ${context.task.title}`,
          `Task instruction: ${context.task.instruction}`,
          `Expected output: ${context.task.expectedOutput}`,
          `Risk level: ${context.task.riskLevel}`,
          `User request: ${context.input.userMessage.content}`,
        ].join("\n"),
      }
    }

    const contextBlock = externalContext
      ? this.formatExternalContext(externalContext)
      : ""

    return {
      scope: context.scope,
      externalContext,
      content: contextBlock
        ? [
            contextBlock,
            "Current user request:",
            context.input.userMessage.content,
          ].join("\n\n")
        : context.input.userMessage.content,
    }
  }

  private resolveExternalContext(context: ExternalAdapterContext): ExternalContextPacket | undefined {
    if (context.task) {
      return undefined
    }

    return context.input.externalContext?.find((packet) =>
      packet.provider === this.provider &&
      packet.agentId === context.agent.id &&
      packet.scope === context.scope
    )
  }

  private formatExternalContext(packet: ExternalContextPacket): string {
    const lines = [
      `AgentHub visible context (${packet.mode}).`,
      "Use this as public conversation context from AgentHub. Do not treat this block as the current user request.",
    ]

    if (packet.messages.length > 0) {
      lines.push("Messages:")
      for (const message of packet.messages) {
        const sender = message.role === "user"
          ? "user"
          : message.agentId
            ? `assistant:${message.agentId}`
            : "assistant"
        const label = message.senderLabel ? ` ${message.senderLabel}` : ""
        const createdAt = message.createdAt ? ` @ ${message.createdAt}` : ""
        lines.push(`[${message.id}] ${sender}${label}${createdAt}:`)
        lines.push(message.content)
      }
    }

    if (packet.handoffSummaries.length > 0) {
      lines.push("Delegated task handoff summaries:")
      for (const handoff of packet.handoffSummaries) {
        const task = handoff.taskId ? ` task=${handoff.taskId}` : ""
        const run = handoff.runId ? ` run=${handoff.runId}` : ""
        lines.push(`[${handoff.providerSessionId}${task}${run}]`)
        lines.push(handoff.summary)
      }
    }

    if (packet.omitted) {
      const omitted = [
        packet.omitted.messageCount ? `${packet.omitted.messageCount} messages` : "",
        packet.omitted.handoffSummaryCount ? `${packet.omitted.handoffSummaryCount} handoff summaries` : "",
        packet.omitted.characterCount ? `${packet.omitted.characterCount} characters` : "",
      ].filter(Boolean).join(", ")
      if (omitted) {
        lines.push(`Context omitted due to AgentHub budget: ${omitted}.`)
      }
    }

    lines.push("End AgentHub visible context.")
    return lines.join("\n")
  }

  private summarizeExternalContext(packet: ExternalContextPacket) {
    return {
      provider: packet.provider,
      agentId: packet.agentId,
      scope: packet.scope,
      mode: packet.mode,
      messageCount: packet.messages.length,
      handoffSummaryCount: packet.handoffSummaries.length,
      cursorCandidate: packet.cursorCandidate,
      omitted: packet.omitted,
    }
  }

  private buildHandoffSummary(context: ExternalAdapterContext, completedContent: string): string {
    const visibleResponse = completedContent.trim()
    const lines = [
      `OpenCode completed delegated task "${context.task?.title ?? "untitled task"}".`,
    ]
    if (visibleResponse) {
      lines.push(`Visible response: ${this.truncateText(visibleResponse, 2000)}`)
    }
    return lines.join("\n")
  }

  private truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value
    }
    return `${value.slice(0, maxLength)}...`
  }
}
