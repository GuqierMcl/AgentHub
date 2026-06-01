import type { TerminalTabPayload } from "@/store/tab-store"
import { terminalApi } from "../api/terminal"
import type { TerminalWsEvent } from "./types"

export type TerminalSessionHandle = {
  sessionId: string
  sendInput: (data: string) => void
  sendResize: (cols: number, rows: number) => void
  disconnect: () => void
  destroy: () => void
}

export type TerminalConnectionEvents = {
  onReady?: (sessionId: string) => void
  onOutput?: (chunk: string) => void
  onExit?: (code: number | null) => void
  onError?: (message: string) => void
  onReplay?: (chunks: string[]) => void
  onConnecting?: () => void
  onReconnecting?: () => void
}

type ActiveConnection = {
  sessionId: string
  payload: TerminalTabPayload
  events: TerminalConnectionEvents
  ws: WebSocket
  closed: boolean
  closeAfterOpen: boolean
  hasConnected: boolean
  retryCount: number
  retryTimer?: ReturnType<typeof setTimeout>
}

const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAYS_MS = [1000, 2000, 3000]

class TerminalConnectionManager {
  private connections = new Map<string, ActiveConnection>()

  private closeConnection(
    conn: ActiveConnection,
    destroy: boolean,
  ): void {
    this.clearRetry(conn)
    conn.closed = true
    this.connections.delete(conn.sessionId)

    if (destroy) {
      terminalApi
        .closeSession(conn.payload.conversationId, conn.sessionId)
        .catch(() => {})
    }

    if (conn.ws.readyState === WebSocket.CONNECTING) {
      conn.closeAfterOpen = true
      return
    }

    if (
      conn.ws.readyState === WebSocket.OPEN ||
      conn.ws.readyState === WebSocket.CLOSING
    ) {
      try {
        conn.ws.close()
      } catch {
        // ignore close errors
      }
    }
  }

  private setupWsHandlers(conn: ActiveConnection): void {
    const { ws, sessionId, events } = conn

    ws.onopen = () => {
      if (conn.closeAfterOpen || conn.closed) {
        try {
          ws.close()
        } catch {
          // ignore close errors
        }
      }
    }

    ws.onmessage = (evt: MessageEvent) => {
      if (conn.closed) return
      try {
        const msg = JSON.parse(evt.data as string) as TerminalWsEvent
        switch (msg.type) {
          case "output":
            events.onOutput?.(msg.data)
            break
          case "replay":
            events.onReplay?.(msg.chunks)
            break
          case "exit":
            conn.closed = true
            this.connections.delete(sessionId)
            events.onExit?.(msg.code)
            break
          case "error":
            events.onError?.(msg.message)
            break
          case "ready":
            conn.hasConnected = true
            conn.retryCount = 0
            events.onReady?.(msg.sessionId)
            break
        }
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      if (conn.closed) return
      if (conn.hasConnected) {
        this.tryReconnect(conn)
      } else {
        conn.closed = true
        this.connections.delete(sessionId)
        events.onExit?.(null)
      }
    }

    ws.onerror = () => {
      if (conn.closed) return
      events.onError?.("WebSocket 连接错误")
    }
  }

  private tryReconnect(conn: ActiveConnection): void {
    if (conn.retryCount >= MAX_RECONNECT_ATTEMPTS) {
      conn.closed = true
      this.connections.delete(conn.sessionId)
      conn.events.onError?.("重连失败，已达最大重试次数")
      return
    }

    conn.retryCount++
    conn.events.onReconnecting?.()

    const delay = RECONNECT_DELAYS_MS[conn.retryCount - 1] ?? 3000
    conn.retryTimer = setTimeout(() => {
      if (conn.closed) return

      const newWs = new WebSocket(terminalApi.wsUrl(conn.sessionId))
      conn.ws = newWs
      this.setupWsHandlers(conn)
    }, delay)
  }

  private clearRetry(conn: ActiveConnection): void {
    if (conn.retryTimer) {
      clearTimeout(conn.retryTimer)
      conn.retryTimer = undefined
    }
  }

  private buildHandle(conn: ActiveConnection): TerminalSessionHandle {
    return {
      sessionId: conn.sessionId,
      sendInput: (data: string) => {
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.send(JSON.stringify({ type: "input", data }))
        }
      },
      sendResize: (cols: number, rows: number) => {
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.send(JSON.stringify({ type: "resize", cols, rows }))
        }
      },
      disconnect: () => {
        this.closeConnection(conn, false)
      },
      destroy: () => {
        this.closeConnection(conn, true)
      },
    }
  }

  async createSession(
    payload: TerminalTabPayload,
    events: TerminalConnectionEvents,
    initialCols = 80,
    initialRows = 24,
  ): Promise<TerminalSessionHandle> {
    const { data } = await terminalApi.createSession(payload.conversationId, {
      cols: initialCols,
      rows: initialRows,
    })

    const sessionId = data.sessionId
    const wsUrl = terminalApi.wsUrl(sessionId)
    events.onConnecting?.()
    const ws = new WebSocket(wsUrl)
    const conn: ActiveConnection = {
      sessionId,
      payload,
      events,
      ws,
      closed: false,
      closeAfterOpen: false,
      hasConnected: false,
      retryCount: 0,
    }

    this.setupWsHandlers(conn)
    this.connections.set(sessionId, conn)

    return this.buildHandle(conn)
  }

  async attachSession(
    sessionId: string,
    payload: TerminalTabPayload,
    events: TerminalConnectionEvents,
  ): Promise<TerminalSessionHandle> {
    const wsUrl = terminalApi.wsUrl(sessionId)
    events.onConnecting?.()
    const ws = new WebSocket(wsUrl)
    const conn: ActiveConnection = {
      sessionId,
      payload,
      events,
      ws,
      closed: false,
      closeAfterOpen: false,
      hasConnected: false,
      retryCount: 0,
    }

    this.setupWsHandlers(conn)
    this.connections.set(sessionId, conn)

    return this.buildHandle(conn)
  }

  getConnection(sessionId: string): ActiveConnection | undefined {
    return this.connections.get(sessionId)
  }

  disconnectSession(sessionId: string): void {
    const conn = this.connections.get(sessionId)
    if (conn) {
      this.closeConnection(conn, false)
    }
  }

  closeAll(): void {
    for (const conn of this.connections.values()) {
      this.closeConnection(conn, false)
    }
  }
}

export const terminalConnectionManager = new TerminalConnectionManager()
