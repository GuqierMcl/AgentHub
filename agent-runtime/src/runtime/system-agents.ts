import { generateText, type ModelMessage } from "ai"
import type { AgentDefinition } from "../agents"
import { createChildLogger } from "../logger"
import type { ProviderService } from "../provider"
import {
  AgentModelResolutionError,
  resolveAgentLanguageModel,
  resolveSystemDefaultLanguageModel,
} from "./model-resolver"
import type { SystemModelSettingsService } from "./system-model-settings"
import type { RunInput } from "./types"

const log = createChildLogger("system-agents")

export type SystemAgentId = "title"

export type SystemAgentCompletedData = {
  systemAgentId: SystemAgentId
  conversationId: string
  target: "conversation.title"
  trigger: "first_user_message"
  inheritedModelFromAgentId: string
  modelSource?: "entry-agent" | "system-default"
  resolvedModel?: ReturnType<typeof resolveAgentLanguageModel>["resolvedModel"]
  result: {
    title: string
  }
}

type TitleSystemAgentOptions = {
  runId: string
  input: RunInput
  entryAgent: AgentDefinition
  signal: AbortSignal
}

const TITLE_SYSTEM_PROMPT = [
  "你是 AgentHub 的内部标题生成系统智能体。",
  "根据用户第一次消息生成一个简短会话标题。",
  "只输出标题本身，不要解释，不要加引号。",
  "标题应为中文优先，除非用户消息明显使用其他语言。",
  "标题最多 18 个中文字符或 8 个英文词。",
].join(" ")

function shouldRunTitleAgent(input: RunInput): boolean {
  if (
    input.conversationState?.titleSource === "manual" ||
    input.conversationState?.titleSource === "auto"
  ) {
    return false
  }

  if (input.conversationState?.titleSource === "default") {
    return Boolean(resolveTitleSeedUserMessage(input))
  }

  const messageCountBeforeRun = input.conversationState?.messageCountBeforeRun
  if (messageCountBeforeRun !== undefined) {
    return messageCountBeforeRun === 0
  }

  return input.history.length === 0
}

function buildTitleMessages(input: RunInput): ModelMessage[] {
  const seed = resolveTitleSeedUserMessage(input) ?? input.userMessage.content
  return [
    {
      role: "user",
      content: [
        "请为下面这次首次对话生成一个短标题：",
        "",
        seed,
      ].join("\n"),
    },
  ]
}

function resolveTitleSeedUserMessage(input: RunInput): string | null {
  const explicitSeed = input.conversationState?.titleSeedUserMessage?.trim()
  if (explicitSeed) {
    return explicitSeed
  }

  const firstHistoryUserMessage = input.history.find((message) =>
    message.role === "user" && message.content.trim().length > 0
  )?.content.trim()
  if (firstHistoryUserMessage) {
    return firstHistoryUserMessage
  }

  const currentUserMessage = input.userMessage.content.trim()
  return currentUserMessage || null
}

function normalizeTitle(rawTitle: string): string | null {
  const title = rawTitle
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[。.!！?？]+$/g, "")
    .trim()

  if (!title) {
    return null
  }

  return title.length > 80 ? title.slice(0, 80).trim() : title
}

function createFallbackTitle(seed: string): string | null {
  const firstLine = seed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  if (!firstLine) {
    return null
  }

  const normalized = normalizeTitle(
    firstLine
      .replace(/[`*_>#\[\](){}]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[：:，,；;]+$/g, "")
  )
  if (!normalized) {
    return null
  }

  if (/[\u3400-\u9fff]/.test(normalized)) {
    return normalized.length > 18 ? normalized.slice(0, 18).trim() : normalized
  }

  const words = normalized.split(/\s+/).filter(Boolean)
  return words.length > 8 ? words.slice(0, 8).join(" ") : normalized
}

export function createFallbackTitleSystemAgentResult(
  input: RunInput,
  entryAgent: AgentDefinition
): SystemAgentCompletedData | null {
  const seed = resolveTitleSeedUserMessage(input)
  if (!seed) {
    return null
  }

  const title = createFallbackTitle(seed)
  if (!title) {
    return null
  }

  return {
    systemAgentId: "title",
    conversationId: input.conversationId,
    target: "conversation.title",
    trigger: "first_user_message",
    inheritedModelFromAgentId: entryAgent.id,
    result: {
      title,
    },
  }
}

export class SystemAgentRunner {
  constructor(
    private providerService: ProviderService,
    private systemModelSettingsService?: SystemModelSettingsService,
    private generateTextImpl: typeof generateText = generateText
  ) {}

  shouldRunTitle(input: RunInput): boolean {
    return shouldRunTitleAgent(input)
  }

  async runTitle(options: TitleSystemAgentOptions): Promise<SystemAgentCompletedData | null> {
    const { runId, input, entryAgent, signal } = options
    if (!this.shouldRunTitle(input) || signal.aborted) {
      return null
    }

    try {
      const resolution = this.resolveTitleModel(entryAgent)
      const result = await this.generateTextImpl({
        model: resolution.languageModel,
        system: TITLE_SYSTEM_PROMPT,
        messages: buildTitleMessages(input),
        maxOutputTokens: 64,
        temperature: resolution.resolvedModel.capabilities.temperature ? 0.2 : undefined,
        abortSignal: signal,
      })

      if (signal.aborted) {
        return null
      }

      const title = normalizeTitle(result.text)
      if (!title) {
        return null
      }

      return {
        systemAgentId: "title",
        conversationId: input.conversationId,
        target: "conversation.title",
        trigger: "first_user_message",
        inheritedModelFromAgentId: entryAgent.id,
        modelSource: resolution.resolvedModel.modelSourceType === "system-default"
          ? "system-default"
          : "entry-agent",
        resolvedModel: resolution.resolvedModel,
        result: {
          title,
        },
      }
    } catch (error) {
      if (signal.aborted) {
        return null
      }

      log.warn(
        {
          runId,
          agentId: entryAgent.id,
          code: error instanceof AgentModelResolutionError ? error.code : undefined,
          error: error instanceof Error ? error.message : String(error),
        },
        "Title system agent did not produce a result"
      )
      return null
    }
  }

  private resolveTitleModel(entryAgent: AgentDefinition): ReturnType<typeof resolveAgentLanguageModel> {
    const systemDefaultModelRef = this.systemModelSettingsService?.getSystemDefaultModelRef()
    if (systemDefaultModelRef) {
      return resolveSystemDefaultLanguageModel(this.providerService, systemDefaultModelRef, {
        agentId: "system:title",
        fallbackFromModelRef: entryAgent.modelRef,
      })
    }

    return resolveAgentLanguageModel(this.providerService, entryAgent)
  }
}
