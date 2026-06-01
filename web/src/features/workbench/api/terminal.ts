import type { TerminalSessionInfo } from "../terminal/types"

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const errMsg = body?.error?.message || `请求失败 (${res.status})`
    throw new Error(errMsg)
  }
  return res.json()
}

async function requestWithBody<T>(path: string, method: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method,
    body: JSON.stringify(body),
  })
}

export type CreateTerminalParams = {
  cols?: number
  rows?: number
}

export type CreateTerminalResponse = {
  data: TerminalSessionInfo
}

export type ListTerminalsResponse = {
  data: TerminalSessionInfo[]
}

export type CloseTerminalResponse = {
  data: { sessionId: string; status: string }
}

function buildBaseUrl(conversationId: string): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}/terminals`
}

export const terminalApi = {
  createSession(conversationId: string, params?: CreateTerminalParams): Promise<CreateTerminalResponse> {
    return requestWithBody<CreateTerminalResponse>(
      buildBaseUrl(conversationId),
      "POST",
      params ?? {},
    )
  },

  listSessions(conversationId: string): Promise<ListTerminalsResponse> {
    return request<ListTerminalsResponse>(buildBaseUrl(conversationId))
  },

  closeSession(conversationId: string, sessionId: string): Promise<CloseTerminalResponse> {
    return request<CloseTerminalResponse>(
      `${buildBaseUrl(conversationId)}/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    )
  },

  wsUrl(sessionId: string): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    return `${protocol}//${window.location.host}/api/terminals/${encodeURIComponent(sessionId)}/ws`
  },
}
