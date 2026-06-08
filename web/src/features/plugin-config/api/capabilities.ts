import type {
  CapabilitiesResponse,
  CapabilitySource,
  WorkspaceCapabilitiesResponse,
} from "../types"

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message || `请求失败 (${res.status})`)
  }
  return res.json()
}

export const capabilitiesApi = {
  fetchGlobal(): Promise<CapabilitiesResponse> {
    const params = new URLSearchParams()
    params.set("scope", "global")
    return request(`/api/runtime/capabilities?${params.toString()}`)
  },

  fetchWorkspaceGroups(conversationId?: string): Promise<WorkspaceCapabilitiesResponse> {
    const params = new URLSearchParams()
    params.set("scope", "workspace")
    if (conversationId) {
      params.set("conversationId", conversationId)
    }
    return request(`/api/runtime/capabilities?${params.toString()}`)
  },

  refreshGlobal(sources?: CapabilitySource[]): Promise<CapabilitiesResponse> {
    const body: Record<string, unknown> = { scope: "global" }
    if (sources?.length) {
      body.sources = sources
    }
    return request("/api/runtime/capabilities/refresh", {
      method: "POST",
      body: JSON.stringify(body),
    })
  },

  refreshWorkspaceGroups(
    conversationId?: string,
    sources?: CapabilitySource[],
  ): Promise<WorkspaceCapabilitiesResponse> {
    const body: Record<string, unknown> = { scope: "workspace" }
    if (conversationId) {
      body.conversationId = conversationId
    }
    if (sources?.length) {
      body.sources = sources
    }
    return request("/api/runtime/capabilities/refresh", {
      method: "POST",
      body: JSON.stringify(body),
    })
  },
}
