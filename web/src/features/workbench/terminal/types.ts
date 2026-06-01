export type TerminalViewStatus =
  | "idle"
  | "creating"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "expired"
  | "error"

export type TerminalSessionStatus =
  | "starting"
  | "running"
  | "closing"
  | "closed"
  | "error"

export type TerminalSessionInfo = {
  sessionId: string
  conversationId: string
  workspaceId: string
  workspaceRoot: string
  shell: string
  status: TerminalSessionStatus
  cols: number
  rows: number
  createdAt: string
  lastActiveAt: string
  errorMessage?: string
}

export type TerminalConnectionStubOptions = {
  simulateDelayMs?: number
  simulateError?: boolean
}

export type TerminalWsMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }

export type TerminalWsEvent =
  | { type: "output"; data: string }
  | { type: "replay"; chunks: string[] }
  | { type: "exit"; code: number | null }
  | { type: "error"; message: string }
  | { type: "ready"; sessionId: string }
