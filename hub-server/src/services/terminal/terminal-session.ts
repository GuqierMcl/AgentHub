import { EventEmitter } from "node:events"
import { fileURLToPath } from "node:url"

import { TerminalRingBuffer } from "./terminal-ring-buffer"
import { resolveShell } from "./shell-resolver"

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
    stdin: { write: (data: string) => void; end?: () => void }
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
  private stderrReader: ReadableStreamDefaultReader | null = null
  private helperBuffer = ""
  private exitEmitted = false
  private readonly shellArgs: string[]

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
    this.shellArgs = resolved.args
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
      const nodeBinary =
        process.env.AGENTHUB_NODE_BIN ?? Bun.which("node") ?? null
      if (!nodeBinary) {
        throw new Error("Node.js runtime not found for terminal PTY helper")
      }

      const helperScript = fileURLToPath(
        new URL("./pty-session-host.cjs", import.meta.url),
      )

      const helperProcess = Bun.spawn([nodeBinary, helperScript], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          PTY_SHELL: this.shell,
          PTY_ARGS_JSON: JSON.stringify(this.shellArgs),
          PTY_CWD: this.workspaceRoot,
          PTY_COLS: String(this.cols),
          PTY_ROWS: String(this.rows),
          PTY_TERM_NAME: "xterm-256color",
        },
        onExit: (_proc, exitCode, signalCode) => {
          this._status = this._status === "error" ? "error" : "closed"
          if (!this.exitEmitted) {
            this.exitEmitted = true
            this.emitter.emit("exit", exitCode, signalCode)
          }
          this.proc = null
        },
      })

      this._status = "running"
      this.exitEmitted = false
      this.helperBuffer = ""

      const readOutput = async () => {
        const reader = helperProcess.stdout.getReader()
        this.reader = reader
        const decoder = new TextDecoder()

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const text = decoder.decode(value, { stream: true })
            this.handleHelperStdout(text)
          }
        } catch {
          // stream closed
        }
      }

      readOutput()

      const readStderr = async () => {
        const reader = helperProcess.stderr.getReader()
        this.stderrReader = reader
        const decoder = new TextDecoder()

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const text = decoder.decode(value, { stream: true })
            if (text.trim().length === 0) continue
            this._lastActiveAt = new Date().toISOString()
            this.emitter.emit("error", text.trim())
          }
        } catch {
          // stream closed
        }
      }

      readStderr()

      this.proc = {
        stdin: {
          write: (data: string) => {
            try {
              helperProcess.stdin.write(data)
            } catch {
              // stdin may be closed
            }
          },
          end: () => {
            try {
              helperProcess.stdin.end()
            } catch {
              // stdin may already be closed
            }
          },
        },
        stdout: helperProcess.stdout,
        pid: helperProcess.pid,
        kill: () => {
          helperProcess.kill()
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
    this.sendHelperMessage({ type: "input", data })
  }

  resize(_cols: number, _rows: number): void {
    this.cols = _cols
    this.rows = _rows
    this._lastActiveAt = new Date().toISOString()
    this.sendHelperMessage({ type: "resize", cols: _cols, rows: _rows })
  }

  kill(): void {
    this._status = "closing"
    try {
      if (this.reader) {
        this.reader.cancel()
        this.reader = null
      }
      if (this.stderrReader) {
        this.stderrReader.cancel()
        this.stderrReader = null
      }
      this.sendHelperMessage({ type: "close" })
      this.proc?.stdin.end?.()
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

  private sendHelperMessage(message: Record<string, unknown>): void {
    if (!this.proc) return
    try {
      this.proc.stdin.write(`${JSON.stringify(message)}\n`)
    } catch {
      // stdin may be closed
    }
  }

  private handleHelperStdout(chunk: string): void {
    this.helperBuffer += chunk

    while (true) {
      const newlineIndex = this.helperBuffer.indexOf("\n")
      if (newlineIndex === -1) {
        break
      }

      const line = this.helperBuffer.slice(0, newlineIndex).trim()
      this.helperBuffer = this.helperBuffer.slice(newlineIndex + 1)

      if (!line) {
        continue
      }

      try {
        const message = JSON.parse(line) as
          | { type: "ready" }
          | { type: "output"; data: string }
          | { type: "error"; message: string }
          | { type: "exit"; code: number | null; signal: number | null }

        switch (message.type) {
          case "ready":
            this._lastActiveAt = new Date().toISOString()
            break
          case "output":
            this._lastActiveAt = new Date().toISOString()
            this.replayBuffer.write(message.data)
            this.emitter.emit("output", message.data)
            break
          case "error":
            this._lastActiveAt = new Date().toISOString()
            this._status = "error"
            this.emitter.emit("error", message.message)
            break
          case "exit":
            this._status = "closed"
            if (!this.exitEmitted) {
              this.exitEmitted = true
              this.emitter.emit("exit", message.code, message.signal)
            }
            break
        }
      } catch {
        this._lastActiveAt = new Date().toISOString()
        this.replayBuffer.write(line)
        this.emitter.emit("output", line)
      }
    }
  }
}
