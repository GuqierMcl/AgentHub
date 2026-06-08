import type {
  McpTrustDecisionResponse,
  McpTrustQueryResponse,
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

export const mcpTrustApi = {
  query(conversationId: string, mcpRefs?: string[]): Promise<McpTrustQueryResponse> {
    return request("/api/runtime/mcp-trust/query", {
      method: "POST",
      body: JSON.stringify({
        scope: "workspace",
        conversationId,
        ...(mcpRefs?.length ? { mcpRefs } : {}),
      }),
    })
  },

  decide(input: {
    conversationId: string
    mcpRef: string
    trusted: boolean
    reason?: string
  }): Promise<McpTrustDecisionResponse> {
    return request("/api/runtime/mcp-trust", {
      method: "PUT",
      body: JSON.stringify({
        scope: "workspace",
        conversationId: input.conversationId,
        mcpRef: input.mcpRef,
        trusted: input.trusted,
        ...(input.reason ? { reason: input.reason } : {}),
      }),
    })
  },
}
