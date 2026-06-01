import { TerminalSession } from "./terminal-session"
import type { TerminalSessionInfo, TerminalConfig } from "./types"

export class TerminalSessionRegistry {
  private sessions = new Map<string, TerminalSession>()
  private config: TerminalConfig

  constructor(config: TerminalConfig) {
    this.config = config
  }

  create(
    sessionId: string,
    conversationId: string,
    workspaceId: string,
    workspaceRoot: string,
    cols: number,
    rows: number,
    shellOverride?: string,
  ): TerminalSession {
    const session = new TerminalSession(
      sessionId,
      conversationId,
      workspaceId,
      workspaceRoot,
      cols,
      rows,
      this.config.replayBufferMaxBytes,
      shellOverride,
    )
    this.sessions.set(sessionId, session)
    return session
  }

  get(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId)
  }

  remove(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.kill()
      this.sessions.delete(sessionId)
    }
  }

  listByConversation(conversationId: string): TerminalSession[] {
    const result: TerminalSession[] = []
    for (const session of this.sessions.values()) {
      if (session.conversationId === conversationId) {
        result.push(session)
      }
    }
    return result
  }

  countByConversation(conversationId: string): number {
    return this.listByConversation(conversationId).length
  }

  hasReachedLimit(conversationId: string): boolean {
    return this.countByConversation(conversationId) >= this.config.maxSessionsPerConversation
  }

  getAll(): TerminalSession[] {
    return Array.from(this.sessions.values())
  }

  clearAll(): void {
    for (const session of this.sessions.values()) {
      session.kill()
    }
    this.sessions.clear()
  }

  getSessionInfo(session: TerminalSession): TerminalSessionInfo {
    const size = session.currentSize
    return {
      sessionId: session.sessionId,
      conversationId: session.conversationId,
      workspaceId: session.workspaceId,
      workspaceRoot: session.workspaceRoot,
      shell: session.shell,
      status: session.status,
      cols: size.cols,
      rows: size.rows,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
    }
  }

  listSessionInfosByConversation(conversationId: string): TerminalSessionInfo[] {
    return this.listByConversation(conversationId).map((s) => this.getSessionInfo(s))
  }
}
