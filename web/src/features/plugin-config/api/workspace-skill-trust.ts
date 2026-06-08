import type {
  WorkspaceSkillTrustDecisionResponse,
  WorkspaceSkillTrustQueryResponse,
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

export const workspaceSkillTrustApi = {
  query(conversationId: string, skillRefs?: string[]): Promise<WorkspaceSkillTrustQueryResponse> {
    return request("/api/runtime/workspace-skill-trust/query", {
      method: "POST",
      body: JSON.stringify({
        conversationId,
        ...(skillRefs?.length ? { skillRefs } : {}),
      }),
    })
  },

  decide(input: {
    conversationId: string
    skillRef: string
    trusted: boolean
    reason?: string
  }): Promise<WorkspaceSkillTrustDecisionResponse> {
    return request("/api/runtime/workspace-skill-trust", {
      method: "PUT",
      body: JSON.stringify({
        conversationId: input.conversationId,
        skillRef: input.skillRef,
        trusted: input.trusted,
        ...(input.reason ? { reason: input.reason } : {}),
      }),
    })
  },
}
