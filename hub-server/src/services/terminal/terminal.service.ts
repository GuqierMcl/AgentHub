import { TerminalSessionRegistry } from "./terminal-session-registry"
import type { TerminalSessionInfo, TerminalConfig, TerminalWsEvent } from "./types"
import { generateId } from "../../lib/id"

type AttachCallbacks = {
  send: (data: string) => void
  close: () => void
}

type AttachedEntry = {
  callbacks: AttachCallbacks
}

export class TerminalService {
  private registry: TerminalSessionRegistry
  private attached = new Map<string, AttachedEntry>()
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private config: TerminalConfig
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: TerminalConfig) {
    this.config = config
    this.registry = new TerminalSessionRegistry(config)
  }

  startCleanup(): void {
    if (this.cleanupInterval) return
    this.cleanupInterval = setInterval(() => {
      this.evictExpiredSessions()
    }, 30_000)
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  get registryInstance(): TerminalSessionRegistry {
    return this.registry
  }

  get configInstance(): TerminalConfig {
    return this.config
  }

  createSession(
    conversationId: string,
    workspaceId: string,
    workspaceRoot: string,
    cols: number,
    rows: number,
    shellOverride?: string,
  ): TerminalSessionInfo {
    const sessionId = generateId("term")

    const session = this.registry.create(
      sessionId,
      conversationId,
      workspaceId,
      workspaceRoot,
      cols,
      rows,
      shellOverride,
    )

    session.start()
    return this.registry.getSessionInfo(session)
  }

  attachSession(sessionId: string, callbacks: AttachCallbacks): TerminalWsEvent | null {
    const session = this.registry.get(sessionId)
    if (!session) {
      return { type: "error", message: `Session ${sessionId} not found` }
    }

    this.clearIdleTimer(sessionId)

    if (this.attached.has(sessionId)) {
      const existing = this.attached.get(sessionId)!
      existing.callbacks.close()
      this.attached.delete(sessionId)
    }

    const replayChunks = session.getReplayChunks()
    if (replayChunks.length > 0) {
      callbacks.send(JSON.stringify({ type: "replay", chunks: replayChunks }))
    }

    const entry: AttachedEntry = { callbacks }
    this.attached.set(sessionId, entry)

    const onOutput = (data: string) => {
      callbacks.send(JSON.stringify({ type: "output", data }))
    }
    const onExit = (code: number | null, _signal: number | null) => {
      callbacks.send(JSON.stringify({ type: "exit", code }))
      callbacks.close()
      session.offOutput(onOutput)
      session.offExit(onExit)
      session.offError(onError)
    }
    const onError = (message: string) => {
      callbacks.send(JSON.stringify({ type: "error", message }))
      session.offOutput(onOutput)
      session.offExit(onExit)
      session.offError(onError)
    }

    session.onOutput(onOutput)
    session.onExit(onExit)
    session.onError(onError)

    return null
  }

  detachSession(sessionId: string): void {
    const entry = this.attached.get(sessionId)
    if (entry) {
      entry.callbacks.close()
      this.attached.delete(sessionId)
    }

    this.startIdleTimer(sessionId)
  }

  sendInput(sessionId: string, data: string): void {
    const session = this.registry.get(sessionId)
    if (session) {
      session.write(data)
    }
  }

  resizeSession(sessionId: string, cols: number, rows: number): void {
    const session = this.registry.get(sessionId)
    if (session) {
      session.resize(cols, rows)
    }
  }

  closeSession(sessionId: string): void {
    this.clearIdleTimer(sessionId)

    const entry = this.attached.get(sessionId)
    if (entry) {
      entry.callbacks.close()
      this.attached.delete(sessionId)
    }

    this.registry.remove(sessionId)
  }

  listSessionInfos(conversationId: string): TerminalSessionInfo[] {
    return this.registry.listSessionInfosByConversation(conversationId)
  }

  hasReachedLimit(conversationId: string): boolean {
    return this.registry.hasReachedLimit(conversationId)
  }

  shutdown(): void {
    this.stopCleanup()
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer)
    }
    this.idleTimers.clear()
    for (const [id] of this.attached) {
      const entry = this.attached.get(id)!
      entry.callbacks.close()
    }
    this.attached.clear()
    this.registry.clearAll()
  }

  private startIdleTimer(sessionId: string): void {
    this.clearIdleTimer(sessionId)

    const session = this.registry.get(sessionId)
    if (!session) return

    const timer = setTimeout(() => {
      this.idleTimers.delete(sessionId)
      this.closeSession(sessionId)
    }, this.config.idleTimeoutMs)

    this.idleTimers.set(sessionId, timer)
  }

  private clearIdleTimer(sessionId: string): void {
    const timer = this.idleTimers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.idleTimers.delete(sessionId)
    }
  }

  private evictExpiredSessions(): void {
    const now = Date.now()
    for (const session of this.registry.getAll()) {
      if (session.status === "closed" || session.status === "error") {
        this.closeSession(session.sessionId)
        continue
      }

      const lastActive = new Date(session.lastActiveAt).getTime()
      if (now - lastActive > this.config.idleTimeoutMs && !this.attached.has(session.sessionId)) {
        this.closeSession(session.sessionId)
      }
    }
  }
}
