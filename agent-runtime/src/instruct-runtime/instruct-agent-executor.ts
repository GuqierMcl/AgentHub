import { stepCountIs, streamText, type ModelMessage } from "ai"
import { createChildLogger } from "../logger"
import type { AgentModelRef, AgentDefinition } from "../agents"
import {
  AgentModelResolutionError,
  resolveAgentLanguageModel,
  resolveSystemDefaultLanguageModel,
} from "../runtime/model-resolver"
import { MessageBlockEventBuilder, MessageBlockIdentityTracker } from "../runtime/message-stream-events"
import { ModelStreamEventBuilder } from "../runtime/model-stream-events"
import { createRuntimeGeneration, normalizeLanguageModelUsage } from "../runtime/generation"
import { createRunEvent } from "../runtime/run-events"
import type { PendingQuestionToolCall } from "../runtime/question"
import {
  runWithPreVisibleFallback,
  type ModelAttempt,
} from "../runtime/pre-visible-model-fallback"
import type { SystemModelSettingsService } from "../runtime/system-model-settings"
import type { AgentExecutionContext, AgentExecutor, RunEvent } from "../runtime/types"
import type { ProviderService } from "../provider"
import type { InstructToolRegistry } from "./tools"
import type { InstructRunInput } from "./types"

const log = createChildLogger("instruct-agent-executor")
const DEFAULT_TEMPERATURE = 0.3

type AiSdkModelResolution = ReturnType<typeof resolveAgentLanguageModel>

type AiSdkModelAttempt = ModelAttempt & {
  resolution: AiSdkModelResolution
}

function buildSystemPrompt(context: AgentExecutionContext): string {
  const input = context.input as unknown as InstructRunInput
  const notes: string[] = []

  if (context.agent.systemPrompt) {
    notes.push(context.agent.systemPrompt)
  }

  notes.push(
    [
      `Agent: ${context.agent.name}`,
      `Description: ${context.agent.description}`,
      `Capabilities: ${context.agent.capabilities.length > 0 ? context.agent.capabilities.join(", ") : "none"}`,
    ].join("\n")
  )

  if (input.draft) {
    const draft = input.draft
    if (draft.name) notes.push(`User proposed agent name: ${draft.name}`)
    if (draft.description) notes.push(`User proposed description: ${draft.description}`)
    if (draft.systemPrompt) notes.push(`User proposed system prompt: ${draft.systemPrompt}`)
    if (draft.capabilities?.length) notes.push(`User proposed capabilities: ${draft.capabilities.join(", ")}`)
    if (draft.allowedTools?.length) notes.push(`User proposed tools: ${draft.allowedTools.join(", ")}`)
    if (draft.allowedSubagents?.length) notes.push(`User proposed subagents: ${draft.allowedSubagents.join(", ")}`)
    if (draft.permissionPolicy) notes.push(`User proposed permission policy: ${JSON.stringify(draft.permissionPolicy)}`)
  }

  return notes.join("\n\n")
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
) {
  const system = buildSystemPrompt(context)
  const messages = context.resumeMessages ?? normalizeHistoryMessages(context)
  const temperature = supportsTemperature && maxOutputTokens > 0
    ? DEFAULT_TEMPERATURE
    : undefined

  return { system, messages, maxOutputTokens, temperature }
}

export class InstructAgentExecutor implements AgentExecutor {
  executorType = "ai-sdk" as const

  constructor(
    private providerService: ProviderService,
    private toolRegistry: InstructToolRegistry,
    private systemModelSettingsService?: SystemModelSettingsService,
    private streamTextImpl: typeof streamText = streamText
  ) {}

  async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
    const { agent, runId, signal } = context

    if (signal.aborted) {
      log.info({ runId, agentId: agent.id }, "Instruct execution aborted before start")
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

    const failedModelRef = failedAttempt?.resolution.modelRef ?? resolveConfiguredModelRef(context)
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
      return {
        id: createAttemptId(resolution.modelRef, "system-default"),
        resolution,
      }
    } catch (fallbackError) {
      log.warn({ fallbackRef, error: String(fallbackError) }, "Instruct fallback model unavailable")
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
        providerId: resolution.provider.id,
        modelId: resolution.model.id,
        providerProtocol: resolution.provider.api_protocol,
        maxOutputTokens: resolution.resolvedModel.outputLength,
        temperature: resolution.resolvedModel.capabilities.temperature ? DEFAULT_TEMPERATURE : undefined,
        toolCount: resolution.resolvedModel.capabilities.supports_tools
          ? this.toolRegistry.listToolsForAgent(agent).length
          : 0,
      },
      "Resolved instruct model for execution"
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

    const toolSettings = resolution.resolvedModel.capabilities.supports_tools
      ? this.toolRegistry.buildAiSdkToolSettings(streamContext)
      : null

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
            stopWhen: stepCountIs(3),
          }
        : {}),
      abortSignal: signal,
      onError: ({ error }) => {
        log.warn(
          { runId, agentId: agent.id, error: error instanceof Error ? error.message : String(error) },
          "Instruct AI SDK stream error"
        )
      },
    })

    const pendingQuestionCalls: PendingQuestionToolCall[] = []
    const messageBlockEvents = new MessageBlockEventBuilder(streamContext, messageIdentity, baseGeneration)
    const modelStreamEvents = new ModelStreamEventBuilder(streamContext, messageIdentity)

    try {
      for await (const chunk of result.fullStream) {
        if (signal.aborted) {
          log.info({ runId, agentId: agent.id }, "Instruct execution aborted during stream")
          return
        }

        for (const event of modelStreamEvents.createEvents(chunk)) {
          yield event
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
        log.info({ runId, agentId: agent.id }, "Instruct execution aborted after stream consumption")
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

      log.info({ runId, agentId: agent.id, finishReason }, "Instruct execution completed")
    } catch (error) {
      if (signal.aborted) {
        log.info({ runId, agentId: agent.id }, "Instruct execution aborted with error")
        return
      }

      log.error(
        { runId, agentId: agent.id, error: error instanceof Error ? error.message : String(error) },
        "Instruct execution failed"
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
