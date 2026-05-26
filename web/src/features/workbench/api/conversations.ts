import type {
  ConversationListItem,
  ConversationDetail,
  CreateConversationBody,
  ListConversationsResponse,
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

export const conversationsApi = {
  list(params?: {
    status?: "active" | "archived"
    limit?: number
    offset?: number
  }): Promise<ListConversationsResponse> {
    const query = new URLSearchParams()
    if (params?.status) query.set("status", params.status)
    if (params?.limit !== undefined) query.set("limit", String(params.limit))
    if (params?.offset !== undefined) query.set("offset", String(params.offset))
    const qs = query.toString()
    return request(`/api/conversations${qs ? `?${qs}` : ""}`)
  },

  get(id: string): Promise<ConversationDetail> {
    return request(`/api/conversations/${encodeURIComponent(id)}`)
  },

  create(body: CreateConversationBody): Promise<ConversationDetail> {
    return request("/api/conversations", {
      method: "POST",
      body: JSON.stringify(body),
    })
  },

  update(id: string, body: { title?: string; status?: "active" | "archived"; orchestratorAgentId?: string | null; metadata?: Record<string, unknown> }): Promise<ConversationDetail> {
    return request(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })
  },

  delete(id: string): Promise<void> {
    return request(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
  },

  pin(id: string): Promise<ConversationListItem> {
    return request(`/api/conversations/${encodeURIComponent(id)}/pin`, {
      method: "POST",
    })
  },

  unpin(id: string): Promise<ConversationListItem> {
    return request(`/api/conversations/${encodeURIComponent(id)}/unpin`, {
      method: "POST",
    })
  },
}
