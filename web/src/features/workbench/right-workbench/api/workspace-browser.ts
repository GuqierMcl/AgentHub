import type { WorkspaceTreeResponse, WorkspaceFilePreviewResponse, WorkspaceSearchResponse, WorkspaceEditableFileResponse, UpdateWorkspaceFileRequest, UpdateWorkspaceFileResponse } from "../types"

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

async function requestWithBody<T>(path: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const bodyData = await res.json().catch(() => ({}))
    const errMsg = bodyData?.error?.message || `请求失败 (${res.status})`
    throw new Error(errMsg)
  }
  return res.json()
}

function buildUrl(conversationId: string, path: string): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}/workspace/file-content?path=${encodeURIComponent(path)}`
}

export const workspaceBrowserApi = {
  getFileContentUrl(conversationId: string, path: string): string {
    return buildUrl(conversationId, path)
  },

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

  getEditableFile(conversationId: string, path: string): Promise<WorkspaceEditableFileResponse> {
    return request(`/api/conversations/${encodeURIComponent(conversationId)}/workspace/file-edit?path=${encodeURIComponent(path)}`)
  },

  saveFile(conversationId: string, req: UpdateWorkspaceFileRequest): Promise<UpdateWorkspaceFileResponse> {
    return requestWithBody(`/api/conversations/${encodeURIComponent(conversationId)}/workspace/file`, "PUT", req)
  },
}
