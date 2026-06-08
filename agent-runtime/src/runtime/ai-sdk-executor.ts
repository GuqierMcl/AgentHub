import { stepCountIs, streamText, type ModelMessage } from "ai"
import { createChildLogger } from "../logger"
import type { AgentModelRef } from "../agents"
import {
  AgentModelResolutionError,
  resolveAgentLanguageModel,
  resolveSystemDefaultLanguageModel,
} from "./model-resolver"
import { MessageBlockEventBuilder, MessageBlockIdentityTracker } from "./message-stream-events"
import { ModelStreamEventBuilder, resolveRunDiagnostics } from "./model-stream-events"
import { formatRuntimeEnvironmentSnapshotForPrompt } from "./environment-snapshot"
import { formatPinnedMessagesForPrompt } from "./pinned-messages-prompt"
import { formatInjectedSkillsForPrompt } from "./skill-prompt"
import { formatMcpContextForPrompt } from "./mcp-runtime"
import { createRuntimeGeneration, normalizeLanguageModelUsage } from "./generation"
import { createRunEvent } from "./run-events"
import type { PendingQuestionToolCall } from "./question"
import {
  runWithPreVisibleFallback,
  type ModelAttempt,
} from "./pre-visible-model-fallback"
import type { SystemModelSettingsService } from "./system-model-settings"
import type { AgentExecutionContext, AgentExecutor, RunEvent } from "./types"
import type { RuntimeToolRegistry } from "./tools"
import type { ProviderService } from "../provider"

const log = createChildLogger("ai-sdk-executor")
const DEFAULT_TEMPERATURE = 0.3

type AiSdkExecutionSettings = {
  system: string
  messages: ModelMessage[]
  maxOutputTokens: number
  temperature?: number
}

type AiSdkModelResolution = ReturnType<typeof resolveAgentLanguageModel>

type AiSdkModelAttempt = ModelAttempt & {
  resolution: AiSdkModelResolution
}

export function buildSystemPrompt(context: AgentExecutionContext): string {
  const systemNotes: string[] = []

  if (context.agent.systemPrompt) {
    systemNotes.push(context.agent.systemPrompt)
  }

  systemNotes.push(
    [
      `Agent: ${context.agent.name}`,
      `Description: ${context.agent.description}`,
      `Capabilities: ${context.agent.capabilities.length > 0 ? context.agent.capabilities.join(", ") : "none"}`,
    ].join("\n")
  )

  if (context.task) {
    systemNotes.push(
      [
        `Delegated task title: ${context.task.title}`,
        `Delegated task instruction: ${context.task.instruction}`,
        `Expected output: ${context.task.expectedOutput}`,
        `Risk level: ${context.task.riskLevel}`,
        `Required capabilities: ${context.task.requiredCapabilities.length > 0 ? context.task.requiredCapabilities.join(", ") : "none"}`,
      ].join("\n")
    )
  }

  if (context.parentAgentId) {
    systemNotes.push(`This execution was delegated by agent: ${context.parentAgentId}`)
  }

  if (context.environmentSnapshot) {
    systemNotes.push(formatRuntimeEnvironmentSnapshotForPrompt(context.environmentSnapshot))
  }

  const pinnedBlock = formatPinnedMessagesForPrompt(context.input.pinnedMessages)
  if (pinnedBlock) {
    systemNotes.push(pinnedBlock)
  }

  const skillBlock = formatInjectedSkillsForPrompt(context.injectedSkills)
  if (skillBlock) {
    systemNotes.push(skillBlock)
  }

  const mcpBlock = formatMcpContextForPrompt(context.mcpContext)
  if (mcpBlock) {
    systemNotes.push(mcpBlock)
  }

  return systemNotes.join("\n\n")
}

function normalizeHistoryMessages(context: AgentExecutionContext): ModelMessage[] {
  return context.input.history
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: message.content,
    }) satisfies ModelMessage)
    .concat({
      role: "user",
      content: context.input.userMessage.content,
    })
}

function buildExecutionSettings(
  context: AgentExecutionContext,
  maxOutputTokens: number,
  supportsTemperature: boolean
): AiSdkExecutionSettings {
  const system = buildSystemPrompt(context)
  const messages = context.resumeMessages ?? normalizeHistoryMessages(context)
  const temperature = supportsTemperature && maxOutputTokens > 0
    ? DEFAULT_TEMPERATURE
    : undefined

  return {
    system,
    messages,
    maxOutputTokens,
    temperature,
  }
}

export class AiSdkExecutor implements AgentExecutor {
  executorType = "ai-sdk" as const

  constructor(
    private providerService: ProviderService,
    private toolRegistry?: RuntimeToolRegistry,
    private systemModelSettingsService?: SystemModelSettingsService,
    private streamTextImpl: typeof streamText = streamText
  ) {}

  async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
    const { agent, runId, signal } = context

    if (signal.aborted) {
      log.info({ runId, agentId: agent.id }, "AI SDK execution aborted before start")
      return
    }

    yield* runWithPreVisibleFallback<AiSdkModelAttempt>({
      getPrimary: () => this.createPrimaryAttempt(context),
      getFallback: (error, failedAttempt) => this.createFallbackAttempt(context, error, failedAttempt),
      executeAttempt: (attempt) => this.executeResolved(context, attempt.resolution),
    })
  }

  private createPrimaryAttempt(context: AgentExecutionContext): AiSdkModelAttempt {
    const resolution = resolveAgentLanguageModel(this.providerService, context.agent, {
      modelSourceAgent: context.modelSourceAgent,
      systemDefaultModelRef: this.systemModelSettingsService?.getSystemDefaultModelRef(),
    })
    return {
      id: createAttemptId(resolution.modelRef, resolution.resolvedModel.modelSourceType ?? "agent-binding"),
      resolution,
    }
  }

  private createFallbackAttempt(
    context: AgentExecutionContext,
    error: unknown,
    failedAttempt?: AiSdkModelAttempt
  ): AiSdkModelAttempt | null {
    if (context.signal.aborted) {
      return null
    }

    const fallbackRef = this.systemModelSettingsService?.getSystemDefaultModelRef()
    if (!fallbackRef) {
      return null
    }

    const failedModelRef = failedAttempt?.resolution.modelRef ?? resolveConfiguredModelRef(context) ?? undefined
    if (!failedModelRef && isMissingBindingError(error)) {
      return null
    }

    if (failedModelRef && sameModelRef(fallbackRef, failedModelRef)) {
      return null
    }

    try {
      const resolution = resolveSystemDefaultLanguageModel(this.providerService, fallbackRef, {
        agentId: context.agent.id,
        fallbackFromModelRef: failedModelRef,
      })
      log.warn(
        {
          runId: context.runId,
          agentId: context.agent.id,
          failedProviderId: failedModelRef?.providerId,
          failedModelId: failedModelRef?.modelId,
          fallbackProviderId: fallbackRef.providerId,
          fallbackModelId: fallbackRef.modelId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Falling back to system default model before visible output"
      )
      return {
        id: createAttemptId(resolution.modelRef, "system-default"),
        resolution,
      }
    } catch (fallbackError) {
      log.warn(
        {
          runId: context.runId,
          agentId: context.agent.id,
          fallbackProviderId: fallbackRef.providerId,
          fallbackModelId: fallbackRef.modelId,
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        },
        "System default model fallback is unavailable"
      )
      return null
    }
  }

  private async *executeResolved(
    context: AgentExecutionContext,
    resolution: AiSdkModelResolution
  ): AsyncIterable<RunEvent> {
    const { agent, runId, signal, task, parentAgentId, groupId, parentTaskId } = context

    log.info(
      {
        runId,
        agentId: agent.id,
        modelSourceAgentId: resolution.resolvedModel.modelSourceAgentId,
        providerId: resolution.provider.id,
        modelId: resolution.model.id,
        providerProtocol: resolution.provider.api_protocol,
        maxOutputTokens: resolution.resolvedModel.outputLength,
        temperature: resolution.resolvedModel.capabilities.temperature ? DEFAULT_TEMPERATURE : undefined,
        toolCount: resolution.resolvedModel.capabilities.supports_tools && this.toolRegistry
          ? this.toolRegistry.listToolsForAgent(agent).length
          : 0,
      },
      "Resolved AI SDK model for execution"
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
      ...(baseGeneration ? { generation: baseGeneration } : {}),
    })
    started.taskId = task?.taskId
    started.parentAgentId = parentAgentId
    started.parentTaskId = parentTaskId
    started.groupId = groupId
    yield started

    const messageIdentity = new MessageBlockIdentityTracker(context)
    const streamContext: AgentExecutionContext = {
      ...context,
      getCurrentMessageId: () => messageIdentity.getOrCreateCurrentMessageId(),
    }

    const toolSettings = resolution.resolvedModel.capabilities.supports_tools && this.toolRegistry
      ? await this.toolRegistry.buildAiSdkToolSettings(streamContext)
      : null
    const diagnostics = resolveRunDiagnostics(context.input)

    const result = this.streamTextImpl({
      model: resolution.languageModel,
      ...buildExecutionSettings(
        context,
        resolution.resolvedModel.outputLength,
        resolution.resolvedModel.capabilities.temperature
      ),
      ...(toolSettings
        ? {
            tools: toolSettings.tools,
            activeTools: toolSettings.activeTools,
            stopWhen: stepCountIs(5),
          }
        : {}),
      abortSignal: signal,
      includeRawChunks: diagnostics.includeModelStream && diagnostics.includeRawModelChunks,
      onError: ({ error }) => {
        log.warn(
          {
            runId,
            agentId: agent.id,
            error: error instanceof Error ? error.message : String(error),
          },
          "AI SDK stream error"
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
          log.info({ runId, agentId: agent.id }, "AI SDK execution aborted during stream")
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
        log.info({ runId, agentId: agent.id }, "AI SDK execution aborted after stream consumption")
        return
      }

      if (approvalPending) {
        for (const event of messageBlockEvents.flushOpenBlocks()) {
          yield event
        }

        const response = await result.response
        context.onApprovalPending?.([
          ...(context.resumeMessages ?? normalizeHistoryMessages(context)),
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
            ...(context.resumeMessages ?? normalizeHistoryMessages(context)),
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
        "AI SDK execution completed"
      )
    } catch (error) {
      if (signal.aborted) {
        log.info({ runId, agentId: agent.id }, "AI SDK execution aborted with error")
        return
      }

      log.error(
        {
          runId,
          agentId: agent.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "AI SDK execution failed"
      )
      throw error
    }
  }
}

function resolveConfiguredModelRef(context: AgentExecutionContext): AgentModelRef | null {
  if (context.agent.tier === "subagent") {
    return context.modelSourceAgent?.modelRef ?? null
  }

  return context.agent.modelRef ?? null
}

function isMissingBindingError(error: unknown): boolean {
  return error instanceof AgentModelResolutionError && error.code === "MODEL_BINDING_MISSING"
}

function sameModelRef(left: AgentModelRef, right: AgentModelRef): boolean {
  return left.providerId === right.providerId && left.modelId === right.modelId
}

function createAttemptId(modelRef: AgentModelRef, source: string): string {
  return `${source}:${modelRef.providerId}/${modelRef.modelId}`
}
