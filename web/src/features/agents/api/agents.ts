import type {
  AgentListResponse,
  AgentDetail,
  AgentDeleteResponse,
  UserAgentCreateRequest,
  UserAgentUpdateRequest,
  AgentModelRef,
  AuthoringOptionsResponse,
  ExternalAgentSettingsUpdateInput,
  ExternalAgentSettingsResponse,
  OpenCodeModelCatalogResponse,
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
    const errMsg = body?.error?.message || `请求失败 (${res.status})`
    const details = body?.error?.details
    if (Array.isArray(details) && details.length > 0) {
      const detailMessages = details.map((d: { message?: string }) => d.message).filter(Boolean)
      if (detailMessages.length > 0) {
        throw new Error(detailMessages.join("；"))
      }
    }
    throw new Error(errMsg)
  }
  return res.json()
}

export const agentsApi = {
  list(params?: {
    includeHidden?: boolean
    enabledOnly?: boolean
    tier?: "primary" | "subagent"
    origin?: "system" | "user" | "external"
    /** When true, returns all tiers (including hidden) — caller should filter visibility client-side */
    allTiers?: boolean
  }): Promise<AgentListResponse> {
    const query = new URLSearchParams()
    if (params?.allTiers) {
      query.set("includeHidden", "true")
    } else if (params?.includeHidden) {
      query.set("includeHidden", "true")
    }
    if (params?.enabledOnly === false) query.set("enabledOnly", "false")
    if (params?.tier) query.set("tier", params.tier)
    if (params?.origin) query.set("origin", params.origin)
    const qs = query.toString()
    return request(`/api/runtime/agents${qs ? `?${qs}` : ""}`)
  },

  authoringOptions(): Promise<AuthoringOptionsResponse> {
    return request("/api/runtime/agents/authoring-options")
  },

  get(agentId: string): Promise<AgentDetail> {
    return request(`/api/runtime/agents/${encodeURIComponent(agentId)}`)
  },

  create(input: UserAgentCreateRequest): Promise<AgentDetail> {
    return request("/api/runtime/agents", {
      method: "POST",
      body: JSON.stringify(input),
    })
  },

  update(agentId: string, input: UserAgentUpdateRequest): Promise<AgentDetail> {
    return request(`/api/runtime/agents/${encodeURIComponent(agentId)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    })
  },

  delete(agentId: string): Promise<AgentDeleteResponse> {
    return request(`/api/runtime/agents/${encodeURIComponent(agentId)}`, {
      method: "DELETE",
    })
  },

  bindModel(agentId: string, modelRef: AgentModelRef): Promise<AgentDetail> {
    return request(`/api/runtime/agents/${encodeURIComponent(agentId)}/model`, {
      method: "PUT",
      body: JSON.stringify(modelRef),
    })
  },

  unbindModel(agentId: string): Promise<AgentDetail> {
    return request(`/api/runtime/agents/${encodeURIComponent(agentId)}/model`, {
      method: "DELETE",
    })
  },

  getExternalSettings(agentId: string): Promise<ExternalAgentSettingsResponse> {
    return request(
      `/api/runtime/agents/${encodeURIComponent(agentId)}/external-settings`
    )
  },

  updateExternalSettings(
    agentId: string,
    input: ExternalAgentSettingsUpdateInput
  ): Promise<ExternalAgentSettingsResponse> {
    return request(
      `/api/runtime/agents/${encodeURIComponent(agentId)}/external-settings`,
      {
        method: "PUT",
        body: JSON.stringify(input),
      }
    )
  },

  listOpenCodeModelCatalog(
    conversationId: string
  ): Promise<OpenCodeModelCatalogResponse> {
    return request("/api/runtime/agents/opencode/model-catalog", {
      method: "POST",
      body: JSON.stringify({ conversationId }),
    })
  },
}
