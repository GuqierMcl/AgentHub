export type WorkspaceMcpServerStatus =
  | "discovered"
  | "connecting"
  | "connected"
  | "disabled"
  | "error"

export type WorkspaceMcpStatusServer = {
  id: string
  name: string
  source: "agents" | "codex" | "claude-code" | "opencode"
  transport?: "stdio" | "sse" | "http" | "unknown"
  status: WorkspaceMcpServerStatus
  enabled: boolean
  trusted: boolean
  toolCount: number
  latestError?: string
}

export type WorkspaceMcpStatusResponse = {
  checkedAt: string
  workspace: {
    workspaceId: string
    backendType: "local"
    workspaceRootHash: string
  }
  summary: {
    serverCount: number
    enabledCount: number
    connectedCount: number
    errorCount: number
    toolCount: number
  }
  servers: WorkspaceMcpStatusServer[]
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const message = body?.error?.message || `请求失败 (${response.status})`
    throw new Error(message)
  }
  return response.json()
}

export const workspaceMcpStatusApi = {
  get(conversationId: string): Promise<WorkspaceMcpStatusResponse> {
    return request(`/api/conversations/${encodeURIComponent(conversationId)}/mcp/status`)
  },
}
