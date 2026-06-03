import type { AgentOverride, AvatarOverrideHistoryEntry } from "../types"

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
    throw new Error(errMsg)
  }
  return res.json()
}

export const avatarOverridesApi = {
  list<T>(): Promise<T> {
    return request("/api/avatar-overrides")
  },

  get(agentId: string): Promise<AgentOverride | null> {
    return request(`/api/avatar-overrides/${encodeURIComponent(agentId)}`)
  },

  set(agentId: string, override: AgentOverride): Promise<{ success: boolean }> {
    return request(`/api/avatar-overrides/${encodeURIComponent(agentId)}`, {
      method: "PUT",
      body: JSON.stringify(override),
    })
  },

  async uploadImage(agentId: string, file: File): Promise<{ success: boolean }> {
    const formData = new FormData()
    formData.append("file", file)
    const res = await fetch(`/api/avatar-overrides/${encodeURIComponent(agentId)}/image`, {
      method: "POST",
      body: formData,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      const errMsg = body?.error?.message || `上传失败 (${res.status})`
      throw new Error(errMsg)
    }
    return res.json()
  },

  delete(agentId: string): Promise<{ success: boolean }> {
    return request(`/api/avatar-overrides/${encodeURIComponent(agentId)}`, {
      method: "DELETE",
    })
  },

  imageUrl(agentId: string): string {
    return `/api/avatar-overrides/${encodeURIComponent(agentId)}/file`
  },

  listHistory(agentId: string): Promise<AvatarOverrideHistoryEntry[]> {
    return request(`/api/avatar-overrides/${encodeURIComponent(agentId)}/history`)
  },

  deleteHistory(agentId: string, historyId: string): Promise<{ success: boolean }> {
    return request(`/api/avatar-overrides/${encodeURIComponent(agentId)}/history/${encodeURIComponent(historyId)}`, {
      method: "DELETE",
    })
  },

  restoreHistory(agentId: string, historyId: string): Promise<{ success: boolean }> {
    return request(`/api/avatar-overrides/${encodeURIComponent(agentId)}/history/${encodeURIComponent(historyId)}/restore`, {
      method: "PUT",
    })
  },

  historyImageUrl(agentId: string, historyId: string): string {
    return `/api/avatar-overrides/${encodeURIComponent(agentId)}/history/${encodeURIComponent(historyId)}/file`
  },
}
