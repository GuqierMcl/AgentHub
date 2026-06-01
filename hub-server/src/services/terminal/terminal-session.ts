import { EventEmitter } from "node:events"

import { TerminalRingBuffer } from "./terminal-ring-buffer"
import { resolveShell, type ShellConfig } from "./shell-resolver"

export type TerminalSessionEvents = {
  onOutput: (data: string) => void
  onExit: (code: number | null, signal: number | null) => void
}

export class TerminalSession {
  readonly sessionId: string
  readonly conversationId: string
  readonly workspaceId: string
  readonly workspaceRoot: string
  readonly shell: string
  readonly createdAt: string

  private proc: {
    stdin: { write: (data: string) => void }
    stdout: ReadableStream<Uint8Array>
    pid: number
    kill: () => void
  } | null = null
  private _status: "starting" | "running" | "closing" | "closed" | "error" = "starting"
  private _lastActiveAt: string
  private cols: number
  private rows: number
  private readonly replayBuffer: TerminalRingBuffer
  private readonly emitter = new EventEmitter()
  private reader: ReadableStreamDefaultReader | null = null

  constructor(
    sessionId: string,
    conversationId: string,
    workspaceId: string,
    workspaceRoot: string,
    cols: number,
    rows: number,
    maxReplayBytes: number,
    shellOverride?: string,
  ) {
    this.sessionId = sessionId
    this.conversationId = conversationId
    this.workspaceId = workspaceId
    this.workspaceRoot = workspaceRoot
    this.cols = cols
    this.rows = rows
    this.createdAt = new Date().toISOString()
    this._lastActiveAt = this.createdAt
    this.replayBuffer = new TerminalRingBuffer(maxReplayBytes)

    const resolved = resolveShell(shellOverride)
    this.shell = resolved.shell
  }

  get status(): "starting" | "running" | "closing" | "closed" | "error" {
    return this._status
  }

  get lastActiveAt(): string {
    return this._lastActiveAt
  }

  get currentSize(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows }
  }

  start(): void {
    if (this.proc) return

    try {
      const shellProcess = Bun.spawn([this.shell], {
        cwd: this.workspaceRoot,
        env: { ...process.env },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        onExit: (proc, exitCode, signalCode, error) => {
          this._status = "closed"
          this.emitter.emit("exit", exitCode, signalCode)
        },
      })

      this._status = "running"

      const readOutput = async () => {
        const reader = shellProcess.stdout.getReader()
        this.reader = reader
        const decoder = new TextDecoder()

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const text = decoder.decode(value, { stream: true })
            this._lastActiveAt = new Date().toISOString()
            this.replayBuffer.write(text)
            this.emitter.emit("output", text)
          }
        } catch {
          // stream closed
        }
      }

      readOutput()

      this.proc = {
        stdin: {
          write: (data: string) => {
            try {
              shellProcess.stdin.write(data)
            } catch {
              // stdin may be closed
            }
          },
        },
        stdout: shellProcess.stdout,
        pid: shellProcess.pid,
        kill: () => {
          shellProcess.kill()
        },
      }
    } catch (err) {
      this._status = "error"
      const message = err instanceof Error ? err.message : String(err)
      this.emitter.emit("error", message)
    }
  }

  write(data: string): void {
    this._lastActiveAt = new Date().toISOString()
    this.proc?.stdin.write(data)
  }

  resize(_cols: number, _rows: number): void {
    this.cols = _cols
    this.rows = _rows
    this._lastActiveAt = new Date().toISOString()
    // resize is a no-op with pipe-based PTY
  }

  kill(): void {
    this._status = "closing"
    try {
      if (this.reader) {
        this.reader.cancel()
        this.reader = null
      }
      this.proc?.kill()
    } catch {
      // already dead
    }
    this._status = "closed"
    this.proc = null
  }

  getReplayChunks(): string[] {
    return this.replayBuffer.snapshot()
  }

  onOutput(cb: (data: string) => void): void {
    this.emitter.on("output", cb)
  }

  offOutput(cb: (data: string) => void): void {
    this.emitter.off("output", cb)
  }

  onExit(cb: (code: number | null, signal: number | null) => void): void {
    this.emitter.on("exit", cb)
  }

  offExit(cb: (code: number | null, signal: number | null) => void): void {
    this.emitter.off("exit", cb)
  }

  onError(cb: (message: string) => void): void {
    this.emitter.on("error", cb)
  }

  offError(cb: (message: string) => void): void {
    this.emitter.off("error", cb)
  }
}
