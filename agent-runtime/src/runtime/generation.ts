import type { LanguageModelUsage } from "ai"
import type { AgentResolvedModelResponse } from "../agents"

export type RuntimeGenerationModel = {
  providerId: string
  modelId: string
  providerName: string
  modelName: string
  modelSourceAgentId?: string
}

export type RuntimeGenerationUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
}

export type RuntimeGeneration = {
  executionId?: string
  model?: RuntimeGenerationModel
  usage?: RuntimeGenerationUsage
  finishReason?: string
  durationMs?: number
}

export function createRuntimeGeneration(options: {
  executionId?: string
  resolvedModel?: AgentResolvedModelResponse
}): RuntimeGeneration | undefined {
  const model = createRuntimeGenerationModel(options.resolvedModel)
  if (!options.executionId && !model) {
    return undefined
  }

  return {
    executionId: options.executionId,
    ...(model ? { model } : {}),
  }
}

export function createRuntimeGenerationModel(
  resolvedModel?: AgentResolvedModelResponse
): RuntimeGenerationModel | undefined {
  if (!resolvedModel) {
    return undefined
  }

  return {
    providerId: resolvedModel.providerId,
    modelId: resolvedModel.modelId,
    providerName: resolvedModel.providerName,
    modelName: resolvedModel.modelName,
    ...(resolvedModel.modelSourceAgentId
      ? { modelSourceAgentId: resolvedModel.modelSourceAgentId }
      : {}),
  }
}

export function normalizeLanguageModelUsage(
  usage: LanguageModelUsage | undefined | null
): RuntimeGenerationUsage | undefined {
  if (!usage) {
    return undefined
  }

  const generationUsage: RuntimeGenerationUsage = {
    inputTokens: getFiniteNumber(usage.inputTokens),
    outputTokens: getFiniteNumber(usage.outputTokens),
    totalTokens: getFiniteNumber(usage.totalTokens),
    reasoningTokens: getFiniteNumber(
      usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens
    ),
    cachedInputTokens: getFiniteNumber(
      usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens
    ),
  }

  return hasDefinedValue(generationUsage) ? generationUsage : undefined
}

export function mergeRuntimeGeneration(
  current: RuntimeGeneration | undefined,
  next: RuntimeGeneration | undefined
): RuntimeGeneration | undefined {
  if (!current) return next
  if (!next) return current

  return {
    ...current,
    ...next,
    model: next.model ?? current.model,
    usage: next.usage
      ? { ...current.usage, ...next.usage }
      : current.usage,
  }
}

export function withRuntimeGenerationData<T>(
  data: T,
  generation: RuntimeGeneration | undefined
): T {
  if (!generation) {
    return data
  }

  const record: Record<string, unknown> = isRecord(data) ? data : {}
  const currentGeneration = isRuntimeGeneration(record.generation)
    ? record.generation
    : undefined
  return {
    ...record,
    generation: mergeRuntimeGeneration(currentGeneration, generation),
  } as T
}

function isRuntimeGeneration(value: unknown): value is RuntimeGeneration {
  return isRecord(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined
}

function hasDefinedValue(record: Record<string, unknown>): boolean {
  return Object.values(record).some((value) => value !== undefined)
}
