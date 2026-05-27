import { generateText, type ModelMessage } from "ai"
import type { AgentDefinition } from "../agents"
import { createChildLogger } from "../logger"
import type { ProviderService } from "../provider"
import { AgentModelResolutionError, resolveAgentLanguageModel } from "./model-resolver"
import type { RunInput } from "./types"

const log = createChildLogger("system-agents")

export type SystemAgentId = "title"

export type SystemAgentCompletedData = {
  systemAgentId: SystemAgentId
  conversationId: string
  target: "conversation.title"
  trigger: "first_user_message"
  inheritedModelFromAgentId: string
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
  if (input.conversationState?.titleSource === "manual") {
    return false
  }

  const messageCountBeforeRun = input.conversationState?.messageCountBeforeRun
  if (messageCountBeforeRun !== undefined) {
    return messageCountBeforeRun === 0
  }

  return input.history.length === 0
}

function buildTitleMessages(input: RunInput): ModelMessage[] {
  return [
    {
      role: "user",
      content: [
        "请为下面这次首次对话生成一个短标题：",
        "",
        input.userMessage.content,
      ].join("\n"),
    },
  ]
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

export class SystemAgentRunner {
  constructor(private providerService: ProviderService) {}

  shouldRunTitle(input: RunInput): boolean {
    return shouldRunTitleAgent(input)
  }

  async runTitle(options: TitleSystemAgentOptions): Promise<SystemAgentCompletedData | null> {
    const { runId, input, entryAgent, signal } = options
    if (!this.shouldRunTitle(input) || signal.aborted) {
      return null
    }

    try {
      const resolution = resolveAgentLanguageModel(this.providerService, entryAgent)
      const result = await generateText({
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
}
