import type { AgentOverride, AvatarLibraryItem } from "../types"
import { buildAgentAvatarImageUrl } from "@/lib/avatar-image-url"

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

  imageUrl(agentId: string, relativePath?: string): string {
    return buildAgentAvatarImageUrl(agentId, relativePath)
  },

  listLibrary(agentId: string): Promise<AvatarLibraryItem[]> {
    return request(`/api/avatar-overrides/${encodeURIComponent(agentId)}/library`)
  },

  libraryImageUrl(agentId: string, filename: string): string {
    return `/api/avatar-overrides/${encodeURIComponent(agentId)}/library/${encodeURIComponent(filename)}`
  },

  async deleteLibraryItem(agentId: string, filename: string): Promise<{ success: boolean }> {
    return request(`/api/avatar-overrides/${encodeURIComponent(agentId)}/library/${encodeURIComponent(filename)}`, {
      method: "DELETE",
    })
  },

  async activateLibraryItem(agentId: string, filename: string): Promise<{ success: boolean }> {
    return request(`/api/avatar-overrides/${encodeURIComponent(agentId)}/library/${encodeURIComponent(filename)}/activate`, {
      method: "PUT",
    })
  },
}
