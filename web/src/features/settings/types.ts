export type SettingsTabId = "runtime" | "provider" | "model"

export type SettingsTab = {
  id: SettingsTabId
  label: string
}

export type SettingsGroup = {
  title: string
  items: SettingsTab[]
}

export type ProviderProtocol = "openai" | "anthropic" | "openai_compatible"

export type ModelCapabilities = {
  supports_tools: boolean
  supports_vision: boolean
  supports_reasoning: boolean
  temperature: boolean
}

export type ModelCost = {
  input: number
  output: number
}

export type ModelResponse = {
  id: string
  upstream_id: string
  name: string
  context_length: number
  output_length: number
  capabilities: ModelCapabilities
  cost: ModelCost
  source: "preset" | "custom"
  enabled: boolean
}

export type ProviderSummary = {
  id: string
  name: string
  api_base: string
  enabled: boolean
  source: "preset" | "custom"
  has_api_key: boolean
  model_count: number
  api_protocol: ProviderProtocol
}

export type ProviderDetail = ProviderSummary & {
  api_key: string | null
  models: Record<string, ModelResponse>
}

export type ProviderListResponse = {
  providers: ProviderSummary[]
}

export type ProviderConfigUpdateRequest = {
  api_key?: string
  enabled?: boolean
  api_base?: string
}

export type ProviderConfigUpdateResponse = {
  id: string
  name: string
  api_base: string
  enabled: boolean
  has_api_key: boolean
  api_protocol: ProviderProtocol
}

export type ModelConfigUpdateRequest = {
  enabled: boolean
}

export type CustomProviderCreateRequest = {
  id: string
  name: string
  api_base: string
  api_key?: string
  models?: Record<
    string,
    {
      name?: string
      upstream_id?: string
      context_length?: number
      supports_tools?: boolean
      supports_vision?: boolean
    }
  >
}

export type CustomProviderUpdateRequest = {
  name?: string
  api_base?: string
  api_key?: string
  models?: Record<
    string,
    {
      name?: string
      upstream_id?: string
      context_length?: number
      supports_tools?: boolean
      supports_vision?: boolean
    }
  >
}

export type CatalogRefreshResponse = {
  status: string
  provider_count: number
}

export type HealthResponse = {
  status: string
  timestamp: string
  uptime: number
}