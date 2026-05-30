import type { WorkspaceTreeResponse, WorkspaceFilePreviewResponse, WorkspaceSearchResponse } from "../types"

async function request<T>(path: string): Promise<T> {
  const res = await fetch(path)
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

export const workspaceBrowserApi = {
  listTree(conversationId: string, path?: string): Promise<WorkspaceTreeResponse> {
    const query = path ? `?path=${encodeURIComponent(path)}` : ""
    return request(`/api/conversations/${encodeURIComponent(conversationId)}/workspace/tree${query}`)
  },

  getFilePreview(conversationId: string, path: string): Promise<WorkspaceFilePreviewResponse> {
    return request(`/api/conversations/${encodeURIComponent(conversationId)}/workspace/file?path=${encodeURIComponent(path)}`)
  },

  search(conversationId: string, query: string): Promise<WorkspaceSearchResponse> {
    return request(`/api/conversations/${encodeURIComponent(conversationId)}/workspace/search?q=${encodeURIComponent(query)}`)
  },
}
