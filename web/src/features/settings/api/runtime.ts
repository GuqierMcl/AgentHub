import type {
  ProviderSummary,
  ProviderDetail,
  ProviderConfigUpdateRequest,
  ProviderConfigUpdateResponse,
  ModelConfigUpdateRequest,
  ModelResponse,
  CustomProviderCreateRequest,
  CustomProviderUpdateRequest,
  CatalogRefreshResponse,
  HealthResponse,
  AgentModelRef,
  SystemModelSettingsResponse,
} from "../types"

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message || `请求失败 (${res.status})`)
  }
  return res.json()
}

export const runtimeApi = {
  getProviders(enabledOnly?: boolean): Promise<{ providers: ProviderSummary[] }> {
    const query = enabledOnly ? "?enabled_only=true" : ""
    return request(`/api/providers${query}`)
  },

  getProvider(id: string): Promise<ProviderDetail> {
    return request(`/api/providers/${encodeURIComponent(id)}`)
  },

  updateProviderConfig(
    id: string,
    config: ProviderConfigUpdateRequest
  ): Promise<ProviderConfigUpdateResponse> {
    return request(`/api/providers/${encodeURIComponent(id)}/config`, {
      method: "PUT",
      body: JSON.stringify(config),
    })
  },

  updateModelConfig(
    providerId: string,
    modelId: string,
    config: ModelConfigUpdateRequest
  ): Promise<ModelResponse> {
    return request(
      `/api/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}/config`,
      {
        method: "PUT",
        body: JSON.stringify(config),
      }
    )
  },

  getSystemDefaultModel(): Promise<SystemModelSettingsResponse> {
    return request("/api/settings/model")
  },

  updateSystemDefaultModel(
    modelRef: AgentModelRef
  ): Promise<SystemModelSettingsResponse> {
    return request("/api/settings/model", {
      method: "PUT",
      body: JSON.stringify(modelRef),
    })
  },

  clearSystemDefaultModel(): Promise<SystemModelSettingsResponse> {
    return request("/api/settings/model", {
      method: "DELETE",
    })
  },

  createCustomProvider(
    data: CustomProviderCreateRequest
  ): Promise<ProviderDetail> {
    return request("/api/custom-providers", {
      method: "POST",
      body: JSON.stringify(data),
    })
  },

  updateCustomProvider(
    id: string,
    data: CustomProviderUpdateRequest
  ): Promise<ProviderDetail> {
    return request(`/api/custom-providers/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    })
  },

  deleteCustomProvider(id: string): Promise<void> {
    return request(`/api/custom-providers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
  },

  refreshCatalog(): Promise<CatalogRefreshResponse> {
    return request("/api/catalog/refresh", { method: "POST" })
  },

  getHealth(): Promise<HealthResponse> {
    return request("/api/runtime/health")
  },
}
