import { stepCountIs, streamText, type ModelMessage } from "ai"
import { createChildLogger } from "../logger"
import { resolveAgentLanguageModel } from "./model-resolver"
import { createRunEvent } from "./run-events"
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

function buildSystemPrompt(context: AgentExecutionContext): string {
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
    private toolRegistry?: RuntimeToolRegistry
  ) {}

  async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
    const { agent, runId, signal, task, parentAgentId, groupId, parentTaskId } = context

    if (signal.aborted) {
      log.info({ runId, agentId: agent.id }, "AI SDK execution aborted before start")
      return
    }

    const resolution = resolveAgentLanguageModel(this.providerService, agent, {
      modelSourceAgent: context.modelSourceAgent,
    })
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

    const started = createRunEvent(runId, "agent.started", agent.id, {
      agentName: agent.name,
      executorType: agent.executorType,
      resolvedModel: resolution.resolvedModel,
    })
    started.taskId = task?.taskId
    started.parentAgentId = parentAgentId
    started.parentTaskId = parentTaskId
    started.groupId = groupId
    yield started

    const toolSettings = resolution.resolvedModel.capabilities.supports_tools && this.toolRegistry
      ? this.toolRegistry.buildAiSdkToolSettings(context)
      : null

    const result = streamText({
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

    let content = ""
    let approvalPending = false

    try {
      for await (const chunk of result.fullStream) {
        if (signal.aborted) {
          log.info({ runId, agentId: agent.id }, "AI SDK execution aborted during stream")
          return
        }

        if (chunk.type === "tool-approval-request") {
          approvalPending = true
          context.permissionService?.bindAiSdkApproval(runId, chunk.toolCall.toolCallId, chunk.approvalId)
          continue
        }
        if (chunk.type !== "text-delta" || !chunk.text) {
          continue
        }

        content += chunk.text
        const delta = createRunEvent(runId, "message.delta", agent.id, {
          delta: chunk.text,
        })
        delta.taskId = task?.taskId
        delta.parentAgentId = parentAgentId
        delta.parentTaskId = parentTaskId
        delta.groupId = groupId
        yield delta
      }

      if (signal.aborted) {
        log.info({ runId, agentId: agent.id }, "AI SDK execution aborted after stream consumption")
        return
      }

      if (approvalPending) {
        const response = await result.response
        context.onApprovalPending?.([
          ...(context.resumeMessages ?? normalizeHistoryMessages(context)),
          ...(response.messages as ModelMessage[]),
        ])
        return
      }

      const [finishReason, usage] = await Promise.all([
        result.finishReason,
        result.usage,
      ])

      if (!content) {
        content = await Promise.resolve(result.text).catch(() => "")
      }

      const completed = createRunEvent(runId, "message.completed", agent.id, {
        content,
        finishReason,
        usage,
        resolvedModel: resolution.resolvedModel,
      })
      completed.taskId = task?.taskId
      completed.parentAgentId = parentAgentId
      completed.parentTaskId = parentTaskId
      completed.groupId = groupId
      yield completed

      const agentCompleted = createRunEvent(runId, "agent.completed", agent.id, {
        status: "completed",
        finishReason,
        usage,
        resolvedModel: resolution.resolvedModel,
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
