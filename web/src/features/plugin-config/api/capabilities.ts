import type {
  CapabilitiesResponse,
  CapabilityScope,
  CapabilitySource,
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
  fetch(scope: CapabilityScope, conversationId?: string): Promise<CapabilitiesResponse> {
    const params = new URLSearchParams()
    params.set("scope", scope)
    if (scope !== "global" && conversationId) {
      params.set("conversationId", conversationId)
    }
    return request(`/api/runtime/capabilities?${params.toString()}`)
  },

  refresh(
    scope: CapabilityScope,
    conversationId?: string,
    sources?: CapabilitySource[],
  ): Promise<CapabilitiesResponse> {
    const body: Record<string, unknown> = { scope }
    if (scope !== "global" && conversationId) {
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
