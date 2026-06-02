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

export function extractTerminalConfig(settings: {
  terminal: { maxSessions: number; idleTimeoutMs: number; replayBufferBytes: number }
}): TerminalConfig {
  return {
    maxSessionsPerConversation: settings.terminal.maxSessions,
    idleTimeoutMs: settings.terminal.idleTimeoutMs,
    replayBufferMaxBytes: settings.terminal.replayBufferBytes,
  }
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
