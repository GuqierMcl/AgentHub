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
}

type ActiveConnection = {
  sessionId: string
  payload: TerminalTabPayload
  ws: WebSocket
  closed: boolean
  closeAfterOpen: boolean
}

class TerminalConnectionManager {
  private connections = new Map<string, ActiveConnection>()

  private closeConnection(
    conn: ActiveConnection,
    destroy: boolean,
  ): void {
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
    const ws = new WebSocket(wsUrl)
    const conn: ActiveConnection = {
      sessionId,
      payload,
      ws,
      closed: false,
      closeAfterOpen: false,
    }

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
            events.onReady?.(msg.sessionId)
            break
        }
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      if (conn.closed) return
      conn.closed = true
      this.connections.delete(sessionId)
      events.onExit?.(null)
    }

    ws.onerror = () => {
      if (conn.closed) return
      events.onError?.("WebSocket 连接错误")
    }

    this.connections.set(sessionId, conn)

    const handle: TerminalSessionHandle = {
      sessionId,
      sendInput: (data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }))
        }
      },
      sendResize: (cols: number, rows: number) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols, rows }))
        }
      },
      disconnect: () => {
        this.closeConnection(conn, false)
      },
      destroy: () => {
        this.closeConnection(conn, true)
      },
    }

    return handle
  }

  async attachSession(
    sessionId: string,
    payload: TerminalTabPayload,
    events: TerminalConnectionEvents,
  ): Promise<TerminalSessionHandle> {
    const wsUrl = terminalApi.wsUrl(sessionId)
    const ws = new WebSocket(wsUrl)
    const conn: ActiveConnection = {
      sessionId,
      payload,
      ws,
      closed: false,
      closeAfterOpen: false,
    }

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
            events.onReady?.(msg.sessionId)
            break
        }
      } catch {
        // ignore
      }
    }

    ws.onclose = () => {
      if (conn.closed) return
      conn.closed = true
      this.connections.delete(sessionId)
      events.onExit?.(null)
    }

    ws.onerror = () => {
      if (conn.closed) return
      events.onError?.("WebSocket 连接错误")
    }

    this.connections.set(sessionId, conn)

    const handle: TerminalSessionHandle = {
      sessionId,
      sendInput: (data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "input", data }))
        }
      },
      sendResize: (cols: number, rows: number) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols, rows }))
        }
      },
      disconnect: () => {
        this.closeConnection(conn, false)
      },
      destroy: () => {
        this.closeConnection(conn, true)
      },
    }

    return handle
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
