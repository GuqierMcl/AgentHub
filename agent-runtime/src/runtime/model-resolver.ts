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

  return buildResolvedModelSnapshot(provider, model, {
    modelSourceAgentId: agent.id,
    modelSourceType: "agent-binding",
  })
}

export function resolveAgentLanguageModel(
  providerService: ProviderService,
  agent: AgentDefinition,
  options: {
    modelSourceAgent?: AgentDefinition
    systemDefaultModelRef?: AgentModelRef | null
  } = {}
): {
  provider: ProviderInfo
  model: ProviderModel
  modelRef: AgentModelRef
  languageModel: LanguageModel
  resolvedModel: AgentResolvedModelResponse
} {
  const modelSourceAgent = resolveModelSourceAgent(agent, options.modelSourceAgent)
  const modelSelection = resolveModelRef(agent, modelSourceAgent, options.systemDefaultModelRef)
  const modelRef = modelSelection.modelRef
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
  const resolvedModel = buildResolvedModelSnapshot(provider, model, {
    modelSourceAgentId: modelSelection.modelSourceAgentId,
    modelSourceType: modelSelection.modelSourceType,
  })

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
    modelRef,
    languageModel,
    resolvedModel,
  }
}

export function resolveSystemDefaultLanguageModel(
  providerService: ProviderService,
  modelRef: AgentModelRef,
  options: {
    agentId?: string
    fallbackFromModelRef?: AgentModelRef
  } = {}
): {
  provider: ProviderInfo
  model: ProviderModel
  modelRef: AgentModelRef
  languageModel: LanguageModel
  resolvedModel: AgentResolvedModelResponse
} {
  const provider = providerService.getProvider(modelRef.providerId)
  if (!provider) {
    throw new AgentModelResolutionError(
      "MODEL_PROVIDER_NOT_FOUND",
      `Provider ${modelRef.providerId} not found for system default model`,
      { agentId: options.agentId, modelRef }
    )
  }

  if (!provider.enabled) {
    throw new AgentModelResolutionError(
      "MODEL_DISABLED",
      `Provider ${provider.id} is disabled for system default model`,
      { agentId: options.agentId, providerId: provider.id, modelRef }
    )
  }

  const model = providerService.getModel(modelRef.providerId, modelRef.modelId)
  if (!model) {
    throw new AgentModelResolutionError(
      "MODEL_NOT_FOUND",
      `Model ${modelRef.providerId}/${modelRef.modelId} not found for system default model`,
      { agentId: options.agentId, modelRef }
    )
  }

  if (!model.enabled) {
    throw new AgentModelResolutionError(
      "MODEL_DISABLED",
      `Model ${modelRef.providerId}/${modelRef.modelId} is disabled for system default model`,
      { agentId: options.agentId, modelRef }
    )
  }

  const providerInstance = getProviderInstance(provider)
  return {
    provider,
    model,
    modelRef,
    languageModel: providerInstance.languageModel(model.upstream_id),
    resolvedModel: buildResolvedModelSnapshot(provider, model, {
      modelSourceType: "system-default",
      fallbackFromModelRef: options.fallbackFromModelRef,
    }),
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

function resolveModelRef(
  agent: AgentDefinition,
  modelSourceAgent: AgentDefinition,
  systemDefaultModelRef?: AgentModelRef | null
): {
  modelRef: AgentModelRef
  modelSourceAgentId?: string
  modelSourceType: "agent-binding" | "system-default"
} {
  if (!modelSourceAgent.modelRef) {
    if (systemDefaultModelRef && canUseSystemDefaultForMissingModel(agent, modelSourceAgent)) {
      return {
        modelRef: systemDefaultModelRef,
        modelSourceAgentId: modelSourceAgent.id,
        modelSourceType: "system-default",
      }
    }

    throw new AgentModelResolutionError(
      "MODEL_BINDING_MISSING",
      agent.tier === "subagent"
        ? `Subagent ${agent.id} cannot inherit a model because caller ${modelSourceAgent.id} does not have a model binding`
        : `Agent ${agent.id} does not have a model binding`,
      { agentId: agent.id, modelSourceAgentId: modelSourceAgent.id }
    )
  }

  return {
    modelRef: modelSourceAgent.modelRef,
    modelSourceAgentId: modelSourceAgent.id,
    modelSourceType: "agent-binding",
  }
}

function canUseSystemDefaultForMissingModel(
  agent: AgentDefinition,
  modelSourceAgent: AgentDefinition
): boolean {
  const source = agent.tier === "subagent" ? modelSourceAgent : agent
  return source.origin === "system" &&
    source.tier === "primary" &&
    source.visibility === "visible" &&
    (source.executorType === "ai-sdk" || source.executorType === "orchestrator")
}

export function resolveModelRefSnapshot(
  providerService: ProviderService,
  modelRef: AgentModelRef,
  options: {
    modelSourceAgentId?: string
    modelSourceType?: "agent-binding" | "system-default"
    fallbackFromModelRef?: AgentModelRef
  } = {}
): AgentResolvedModelResponse | null {
  const provider = providerService.getProvider(modelRef.providerId)
  const model = providerService.getModel(modelRef.providerId, modelRef.modelId)

  if (!provider || !model) {
    return null
  }

  return buildResolvedModelSnapshot(provider, model, options)
}

function buildResolvedModelSnapshot(
  provider: ProviderInfo,
  model: ProviderModel,
  options: {
    modelSourceAgentId?: string
    modelSourceType?: "agent-binding" | "system-default"
    fallbackFromModelRef?: AgentModelRef
  } = {}
): AgentResolvedModelResponse {
  return {
    providerId: provider.id,
    modelId: model.id,
    modelSourceAgentId: options.modelSourceAgentId,
    modelSourceType: options.modelSourceType,
    fallbackFromModelRef: options.fallbackFromModelRef,
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
