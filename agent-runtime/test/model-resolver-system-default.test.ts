import { describe, expect, test } from "bun:test"
import type { AgentDefinition, AgentModelRef } from "../src/agents"
import {
  AgentModelResolutionError,
  resolveAgentLanguageModel,
} from "../src/runtime/model-resolver"
import type { ProviderInfo, ProviderModel, ProviderService } from "../src/provider"

function createAgent(overrides: Partial<AgentDefinition>): AgentDefinition {
  return {
    id: "coder",
    name: "Coder",
    description: "Writes code.",
    tier: "primary",
    origin: "system",
    visibility: "visible",
    entryPolicy: "callable",
    delegationPolicy: "terminal",
    executorType: "ai-sdk",
    capabilities: ["Implementation"],
    allowedSubagents: [],
    allowedTools: [],
    allowedSkills: [],
    permissionPolicy: {
      filesystem: "none",
      shell: "none",
      network: "none",
      deploy: "none",
    },
    enabled: true,
    readonly: true,
    ...overrides,
  }
}

function createModel(providerId: string, modelId: string): ProviderModel {
  return {
    id: modelId,
    provider_id: providerId,
    upstream_id: modelId,
    name: modelId,
    context_length: 128000,
    output_length: 4096,
    capabilities: {
      supports_tools: true,
      supports_vision: false,
      supports_reasoning: false,
      temperature: true,
    },
    cost: { input: 0, output: 0 },
    source: "custom",
    enabled: true,
  }
}

function createProvider(providerId: string, model: ProviderModel): ProviderInfo {
  return {
    id: providerId,
    name: providerId,
    api_base: "https://example.test/v1",
    api_key: "test-key",
    enabled: true,
    source: "custom",
    api_protocol: "openai_compatible",
    models: { [model.id]: model },
  }
}

function createProviderService(provider: ProviderInfo): ProviderService {
  return {
    getProvider: (providerId: string) => provider.id === providerId ? provider : null,
    getModel: (providerId: string, modelId: string) =>
      provider.id === providerId ? provider.models[modelId] ?? null : null,
  } as unknown as ProviderService
}

describe("model resolver system default model", () => {
  test("system preset primary agents without a binding use the system default model", () => {
    const defaultRef: AgentModelRef = { providerId: "openai", modelId: "gpt-default" }
    const model = createModel(defaultRef.providerId, defaultRef.modelId)
    const resolution = resolveAgentLanguageModel(
      createProviderService(createProvider(defaultRef.providerId, model)),
      createAgent({ modelRef: undefined }),
      { systemDefaultModelRef: defaultRef }
    )

    expect(resolution.resolvedModel).toMatchObject({
      providerId: "openai",
      modelId: "gpt-default",
      modelSourceType: "system-default",
    })
  })

  test("user agents without a binding still fail instead of using the system default", () => {
    const defaultRef: AgentModelRef = { providerId: "openai", modelId: "gpt-default" }
    const model = createModel(defaultRef.providerId, defaultRef.modelId)

    expect(() =>
      resolveAgentLanguageModel(
        createProviderService(createProvider(defaultRef.providerId, model)),
        createAgent({
          id: "agent_custom",
          origin: "user",
          readonly: false,
          modelRef: undefined,
        }),
        { systemDefaultModelRef: defaultRef }
      )
    ).toThrow(AgentModelResolutionError)
  })
})
