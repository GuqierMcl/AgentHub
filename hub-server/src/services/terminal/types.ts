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

export type TerminalConfig = {
  maxSessionsPerConversation: number
  idleTimeoutMs: number
  replayBufferMaxBytes: number
}

export const DEFAULT_TERMINAL_CONFIG: TerminalConfig = {
  maxSessionsPerConversation: 3,
  idleTimeoutMs: 300_000,
  replayBufferMaxBytes: 4_194_304,
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
