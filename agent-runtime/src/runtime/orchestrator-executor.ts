import { stepCountIs, streamText, type ModelMessage } from "ai"
import type { AgentDefinition, AgentRegistry } from "../agents"
import { createChildLogger } from "../logger"
import type { ProviderService } from "../provider"
import { AgentModelResolutionError, resolveAgentLanguageModel } from "./model-resolver"
import { formatRuntimeEnvironmentSnapshotForPrompt } from "./environment-snapshot"
import { createRuntimeGeneration, normalizeLanguageModelUsage } from "./generation"
import { MessageBlockEventBuilder, MessageBlockIdentityTracker } from "./message-stream-events"
import { ModelStreamEventBuilder, resolveRunDiagnostics } from "./model-stream-events"
import { createRunEvent } from "./run-events"
import type { PendingQuestionToolCall } from "./question"
import type {
  AgentExecutionContext,
  AgentExecutor,
  RunEvent,
} from "./types"
import type { RuntimeToolRegistry } from "./tools"

const log = createChildLogger("orchestrator-executor")
const DEFAULT_TEMPERATURE = 0.2
const ORCHESTRATOR_MAX_STEPS = 6

function normalizeHistoryMessages(context: AgentExecutionContext): ModelMessage[] {
  if (context.resumeMessages) {
    return context.resumeMessages
  }
  return context.input.history
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: message.agentId
        ? `[${message.agentId}] ${message.content}`
        : message.content,
    }) satisfies ModelMessage)
    .concat({
      role: "user",
      content: context.input.userMessage.content,
    })
}

function formatCapabilities(agent: AgentDefinition): string {
  return agent.capabilities.length > 0 ? agent.capabilities.join(", ") : "none"
}

export class OrchestratorExecutor implements AgentExecutor {
  executorType = "orchestrator" as const

  constructor(
    private registry: AgentRegistry,
    private providerService: ProviderService,
    private toolRegistry: RuntimeToolRegistry
  ) {}

  async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
    const { agent, runId, signal, task, parentAgentId, groupId, parentTaskId } = context
    const diagnostics = resolveRunDiagnostics(context.input)

    if (signal.aborted) {
      log.info({ runId, agentId: agent.id }, "Orchestrator execution aborted before start")
      return
    }

    const resolution = resolveAgentLanguageModel(this.providerService, agent)
    if (!resolution.resolvedModel.capabilities.supports_tools) {
      throw new AgentModelResolutionError(
        "MODEL_TOOLS_UNSUPPORTED",
        `Model ${resolution.provider.id}/${resolution.model.id} does not support tool calling required by orchestrator`,
        {
          agentId: agent.id,
          providerId: resolution.provider.id,
          modelId: resolution.model.id,
        }
      )
    }

    const messageIdentity = new MessageBlockIdentityTracker(context)
    const streamContext: AgentExecutionContext = {
      ...context,
      getCurrentMessageId: () => messageIdentity.getOrCreateCurrentMessageId(),
    }

    const toolSettings = this.toolRegistry.buildAiSdkToolSettings(streamContext, {
      includeInternal: true,
    })
    if (!toolSettings || toolSettings.activeTools.length === 0) {
      throw new Error("Orchestrator requires the run_task tool, but no internal tools are available")
    }

    log.info(
      {
        runId,
        agentId: agent.id,
        providerId: resolution.provider.id,
        modelId: resolution.model.id,
        toolCount: toolSettings.activeTools.length,
        activeTools: toolSettings.activeTools,
      },
      "Resolved AI SDK orchestrator model for execution"
    )

    const startedAtMs = Date.now()
    const baseGeneration = createRuntimeGeneration({
      executionId: context.executionId,
      resolvedModel: resolution.resolvedModel,
    })
    const started = createRunEvent(runId, "agent.started", agent.id, {
      agentName: agent.name,
      executorType: agent.executorType,
      resolvedModel: resolution.resolvedModel,
      activeTools: toolSettings.activeTools,
      ...(baseGeneration ? { generation: baseGeneration } : {}),
    })
    started.taskId = task?.taskId
    started.parentAgentId = parentAgentId
    started.parentTaskId = parentTaskId
    started.groupId = groupId
    yield started

    const result = streamText({
      model: resolution.languageModel,
      system: this.buildSystemPrompt(streamContext),
      messages: normalizeHistoryMessages(streamContext),
      maxOutputTokens: resolution.resolvedModel.outputLength,
      temperature: resolution.resolvedModel.capabilities.temperature ? DEFAULT_TEMPERATURE : undefined,
      tools: toolSettings.tools,
      activeTools: toolSettings.activeTools,
      stopWhen: stepCountIs(ORCHESTRATOR_MAX_STEPS),
      abortSignal: signal,
      includeRawChunks: diagnostics.includeModelStream && diagnostics.includeRawModelChunks,
      experimental_onToolCallStart: ({ toolCall }) => {
        log.info(
          {
            runId,
            agentId: agent.id,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
          },
          "Orchestrator AI SDK tool call started"
        )
      },
      experimental_onToolCallFinish: ({ toolCall }) => {
        log.info(
          {
            runId,
            agentId: agent.id,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
          },
          "Orchestrator AI SDK tool call finished"
        )
      },
      onError: ({ error }) => {
        log.warn(
          {
            runId,
            agentId: agent.id,
            error: error instanceof Error ? error.message : String(error),
          },
          "Orchestrator AI SDK stream error"
        )
      },
    })

    let approvalPending = false
    const pendingQuestionCalls: PendingQuestionToolCall[] = []
    const messageBlockEvents = new MessageBlockEventBuilder(streamContext, messageIdentity, baseGeneration)
    const modelStreamEvents = new ModelStreamEventBuilder(streamContext, messageIdentity)

    try {
      for await (const chunk of result.fullStream) {
        if (signal.aborted) {
          log.info({ runId, agentId: agent.id }, "Orchestrator execution aborted during stream")
          return
        }

        for (const event of modelStreamEvents.createEvents(chunk)) {
          yield event
        }

        if (chunk.type === "tool-approval-request") {
          approvalPending = true
          context.permissionService?.bindAiSdkApproval(runId, chunk.toolCall.toolCallId, chunk.approvalId)
          continue
        }

        if (chunk.type === "tool-call" && chunk.toolName === "question") {
          pendingQuestionCalls.push({
            toolCallId: chunk.toolCallId,
            input: chunk.input,
            messageId: messageIdentity.getOrCreateCurrentMessageId(),
          })
        }

        for (const event of messageBlockEvents.createEvents(chunk)) {
          yield event
        }
      }

      if (signal.aborted) {
        log.info({ runId, agentId: agent.id }, "Orchestrator execution aborted after stream consumption")
        return
      }

      if (approvalPending) {
        for (const event of messageBlockEvents.flushOpenBlocks()) {
          yield event
        }

        const response = await result.response
        context.onApprovalPending?.([
          ...normalizeHistoryMessages(context),
          ...(response.messages as ModelMessage[]),
        ])
        return
      }

      if (pendingQuestionCalls.length > 0) {
        for (const event of messageBlockEvents.flushOpenBlocks()) {
          yield event
        }

        const response = await result.response
        const accepted = context.onQuestionPending?.({
          calls: pendingQuestionCalls,
          resumeMessages: [
            ...normalizeHistoryMessages(context),
            ...(response.messages as ModelMessage[]),
          ],
        }) ?? false
        if (accepted) {
          return
        }
      }

      const [finishReason, usage] = await Promise.all([
        result.finishReason,
        result.usage,
      ])

      for (const event of messageBlockEvents.flushOpenBlocks()) {
        yield event
      }

      if (!messageBlockEvents.hasEmittedMessage()) {
        const fallbackText = await Promise.resolve(result.text).catch(() => "")
        const fallbackCompleted = messageBlockEvents.createCompletedFallback(fallbackText)
        if (fallbackCompleted) {
          yield fallbackCompleted
        }
      }

      const agentCompleted = createRunEvent(runId, "agent.completed", agent.id, {
        status: "completed",
        finishReason,
        usage,
        resolvedModel: resolution.resolvedModel,
        ...(baseGeneration
          ? {
              generation: {
                ...baseGeneration,
                usage: normalizeLanguageModelUsage(usage),
                finishReason,
                durationMs: Math.max(0, Date.now() - startedAtMs),
              },
            }
          : {}),
      })
      agentCompleted.taskId = task?.taskId
      agentCompleted.parentAgentId = parentAgentId
      agentCompleted.parentTaskId = parentTaskId
      agentCompleted.groupId = groupId
      yield agentCompleted

      log.info(
        {
          runId,
          agentId: agent.id,
          finishReason,
        },
        "Orchestrator AI SDK execution completed"
      )
    } catch (error) {
      if (signal.aborted) {
        log.info({ runId, agentId: agent.id }, "Orchestrator execution aborted with error")
        return
      }

      log.error(
        {
          runId,
          agentId: agent.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "Orchestrator AI SDK execution failed"
      )
      throw error
    }
  }

  buildSystemPrompt(context: AgentExecutionContext): string {
    const agent = context.agent
    const availableTargets = this.listAvailableTargets(context)
    const participants = context.input.participantAgentIds.join(", ")

    return [
      agent.systemPrompt ?? [
        "You are AgentHub Orchestrator, the default coordination agent for group chats.",
        "Understand the user's request, decide whether another agent should handle part of it, and coordinate the answer without echoing visible participant output.",
      ].join(" "),
      [
        `Current conversation mode: ${context.input.mode}`,
        `Current primary participants: ${participants}`,
        `Your capabilities: ${formatCapabilities(agent)}`,
      ].join("\n"),
      context.environmentSnapshot
        ? formatRuntimeEnvironmentSnapshotForPrompt(context.environmentSnapshot)
        : "",
      [
        "Available run_task targets:",
        availableTargets.length > 0 ? availableTargets.join("\n") : "- none",
      ].join("\n"),
      [
        "Tool rules:",
        "- For complex requests or any request that may need delegation, call write_plan first.",
        "- write_plan records the current UI-renderable plan only; it does not execute tasks.",
        "- If the plan changes, call write_plan again; the latest successful write_plan result is the current plan.",
        "- After delegated run_task work completes, fails, or is cancelled, call write_plan again with the same taskId values to update task status.",
        "- For parallel task batches, update the plan once after the batch result is known instead of writing a separate plan for every finished task.",
        "- Use run_task when another listed target is better suited for a task.",
        "- Each run_task call must target exactly one agent and one task.",
        "- When possible, keep run_task taskId values aligned with the latest write_plan taskId values.",
        "- Use exact targetAgentId values from the available target list.",
        "- Do not invent agent IDs, tools, files, or task results.",
        "- Current primary participants are visible chat participants; their replies are rendered to the user as their own messages.",
        "- When a visible primary participant has already answered, do not repeat, quote, rewrite, or introduce that answer as if you are relaying it.",
        "- After tool results are available, add only incremental value: coordination status, next steps, unresolved risks, or a very short acknowledgement.",
        "- If there is no incremental value to add after delegation, respond with a brief completion note instead of restating the delegated agent's content.",
        "- Only summarize delegated output when it came from a hidden subagent or when the user explicitly asks you to summarize.",
        "- If the request is simple and does not need delegation, answer directly without calling tools.",
      ].join("\n"),
    ].join("\n\n")
  }

  private listAvailableTargets(context: AgentExecutionContext): string[] {
    const participantIds = new Set(context.input.participantAgentIds)
    const targetIds = new Set([
      ...context.input.participantAgentIds,
      ...context.agent.allowedSubagents,
    ])

    return Array.from(targetIds)
      .map((targetId) => this.registry.getAgent(targetId))
      .filter((target): target is AgentDefinition => Boolean(target))
      .filter((target) => target.enabled)
      .filter((target) => target.id !== context.agent.id)
      .filter((target) => {
        if (target.tier === "primary") {
          return target.visibility === "visible" && target.entryPolicy !== "not-callable" && participantIds.has(target.id)
        }

        return (
          target.tier === "subagent" &&
          context.agent.allowedSubagents.includes(target.id) &&
          target.entryPolicy === "not-callable" &&
          target.delegationPolicy === "delegated-only"
        )
      })
      .map((target) => [
        `- ${target.id}`,
        `name: ${target.name}`,
        `tier: ${target.tier}`,
        `origin: ${target.origin}`,
        `executor: ${target.executorType}`,
        `capabilities: ${formatCapabilities(target)}`,
        `description: ${target.description}`,
      ].join(" | "))
  }
}
