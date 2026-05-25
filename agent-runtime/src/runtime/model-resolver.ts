import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import { createChildLogger } from "../logger"
import type { AgentDefinition, AgentModelRef, AgentResolvedModelResponse } from "../agents"
import type { ProviderInfo, ProviderModel, ProviderProtocol, ProviderService } from "../provider"

const log = createChildLogger("model-resolver")

type LanguageModelProvider = {
  languageModel(modelId: string): LanguageModel
}

export class AgentModelResolutionError extends Error {
  constructor(
    public code:
      | "MODEL_BINDING_MISSING"
      | "MODEL_PROVIDER_NOT_FOUND"
      | "MODEL_NOT_FOUND"
      | "MODEL_DISABLED"
      | "MODEL_TOOLS_UNSUPPORTED"
      | "MODEL_UNSUPPORTED_PROVIDER",
    message: string,
    public details?: unknown
  ) {
    super(message)
    this.name = "AgentModelResolutionError"
  }
}

const providerCache = new Map<string, LanguageModelProvider>()

export function resolveAgentModelSnapshot(
  providerService: ProviderService,
  agent: AgentDefinition
): AgentResolvedModelResponse | null {
  if (!agent.modelRef) {
    return null
  }

  const provider = providerService.getProvider(agent.modelRef.providerId)
  const model = providerService.getModel(agent.modelRef.providerId, agent.modelRef.modelId)

  if (!provider || !model) {
    return null
  }

  return buildResolvedModelSnapshot(provider, model, agent.id)
}

export function resolveAgentLanguageModel(
  providerService: ProviderService,
  agent: AgentDefinition,
  options: {
    modelSourceAgent?: AgentDefinition
  } = {}
): {
  provider: ProviderInfo
  model: ProviderModel
  languageModel: LanguageModel
  resolvedModel: AgentResolvedModelResponse
} {
  const modelSourceAgent = resolveModelSourceAgent(agent, options.modelSourceAgent)
  const modelRef = requireModelRef(agent, modelSourceAgent)
  const provider = providerService.getProvider(modelRef.providerId)
  if (!provider) {
    throw new AgentModelResolutionError(
      "MODEL_PROVIDER_NOT_FOUND",
      `Provider ${modelRef.providerId} not found for agent ${agent.id}`,
      { agentId: agent.id, modelSourceAgentId: modelSourceAgent.id, modelRef }
    )
  }

  if (!provider.enabled) {
    throw new AgentModelResolutionError(
      "MODEL_DISABLED",
      `Provider ${provider.id} is disabled for agent ${agent.id}`,
      { agentId: agent.id, modelSourceAgentId: modelSourceAgent.id, providerId: provider.id, modelRef }
    )
  }

  const model = providerService.getModel(modelRef.providerId, modelRef.modelId)
  if (!model) {
    throw new AgentModelResolutionError(
      "MODEL_NOT_FOUND",
      `Model ${modelRef.providerId}/${modelRef.modelId} not found for agent ${agent.id}`,
      { agentId: agent.id, modelSourceAgentId: modelSourceAgent.id, modelRef }
    )
  }

  if (!model.enabled) {
    throw new AgentModelResolutionError(
      "MODEL_DISABLED",
      `Model ${modelRef.providerId}/${modelRef.modelId} is disabled for agent ${agent.id}`,
      { agentId: agent.id, modelSourceAgentId: modelSourceAgent.id, modelRef }
    )
  }

  const providerInstance = getProviderInstance(provider)
  const languageModel = providerInstance.languageModel(model.upstream_id)
  const resolvedModel = buildResolvedModelSnapshot(provider, model, modelSourceAgent.id)

  log.info(
    {
      agentId: agent.id,
      modelSourceAgentId: modelSourceAgent.id,
      providerId: provider.id,
      modelId: model.id,
      providerProtocol: provider.api_protocol,
    },
    "Resolved AI SDK language model for agent"
  )

  return {
    provider,
    model,
    languageModel,
    resolvedModel,
  }
}

function resolveModelSourceAgent(agent: AgentDefinition, modelSourceAgent?: AgentDefinition): AgentDefinition {
  if (agent.tier !== "subagent") {
    return agent
  }

  if (!modelSourceAgent) {
    throw new AgentModelResolutionError(
      "MODEL_BINDING_MISSING",
      `Subagent ${agent.id} requires a caller model binding source`,
      { agentId: agent.id }
    )
  }

  return modelSourceAgent
}

function requireModelRef(agent: AgentDefinition, modelSourceAgent: AgentDefinition): AgentModelRef {
  if (!modelSourceAgent.modelRef) {
    throw new AgentModelResolutionError(
      "MODEL_BINDING_MISSING",
      agent.tier === "subagent"
        ? `Subagent ${agent.id} cannot inherit a model because caller ${modelSourceAgent.id} does not have a model binding`
        : `Agent ${agent.id} does not have a model binding`,
      { agentId: agent.id, modelSourceAgentId: modelSourceAgent.id }
    )
  }

  return modelSourceAgent.modelRef
}

function buildResolvedModelSnapshot(
  provider: ProviderInfo,
  model: ProviderModel,
  modelSourceAgentId?: string
): AgentResolvedModelResponse {
  return {
    providerId: provider.id,
    modelId: model.id,
    modelSourceAgentId,
    providerProtocol: provider.api_protocol,
    providerName: provider.name,
    modelName: model.name,
    upstreamModelId: model.upstream_id,
    contextLength: model.context_length,
    outputLength: model.output_length,
    capabilities: {
      supports_tools: model.capabilities.supports_tools,
      supports_vision: model.capabilities.supports_vision,
      supports_reasoning: model.capabilities.supports_reasoning,
      temperature: model.capabilities.temperature,
    },
    enabled: provider.enabled && model.enabled,
  }
}

function getProviderInstance(provider: ProviderInfo): LanguageModelProvider {
  const cacheKey = `${provider.id}:${provider.api_protocol}:${provider.api_base}:${provider.api_key ?? ""}`
  const cached = providerCache.get(cacheKey)
  if (cached) {
    return cached
  }

  let instance: LanguageModelProvider
  switch (provider.api_protocol as ProviderProtocol) {
    case "openai":
      instance = createOpenAI({
        apiKey: provider.api_key ?? undefined,
        baseURL: provider.api_base || undefined,
      })
      break
    case "anthropic":
      instance = createAnthropic({
        apiKey: provider.api_key ?? undefined,
        baseURL: provider.api_base || undefined,
      })
      break
    case "openai_compatible":
      instance = createOpenAICompatible({
        name: provider.name,
        apiKey: provider.api_key ?? undefined,
        baseURL: provider.api_base,
      })
      break
    default:
      throw new AgentModelResolutionError(
        "MODEL_UNSUPPORTED_PROVIDER",
        `Unsupported provider protocol ${provider.api_protocol} for provider ${provider.id}`,
        { providerId: provider.id, providerProtocol: provider.api_protocol }
      )
  }

  providerCache.set(cacheKey, instance)
  return instance
}
