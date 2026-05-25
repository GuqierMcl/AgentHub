import type {
  AgentListResponse,
  AgentDetail,
  AgentDeleteResponse,
  UserAgentCreateRequest,
  UserAgentUpdateRequest,
  AgentModelRef,
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
}
