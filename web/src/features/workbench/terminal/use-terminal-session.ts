import { useCallback, useEffect, useRef, useState } from "react"

import type { TerminalTabPayload } from "@/store/tab-store"

import {
  terminalConnectionManager,
  type TerminalSessionHandle,
} from "./terminal-connection-manager"
import type { TerminalViewStatus } from "./types"

type UseTerminalSessionOptions = {
  payload: TerminalTabPayload
  initialCols?: number
  initialRows?: number
}

type UseTerminalSessionReturn = {
  status: TerminalViewStatus
  sessionId: string | undefined
  errorMessage: string | undefined
  open: () => Promise<void>
  close: () => void
  sendInput: (data: string) => void
  sendResize: (cols: number, rows: number) => void
  onOutput: (cb: (data: string) => void) => void
  onReplay: (cb: (chunks: string[]) => void) => void
}

export function useTerminalSession({
  payload,
  initialCols = 80,
  initialRows = 24,
}: UseTerminalSessionOptions): UseTerminalSessionReturn {
  const [status, setStatus] = useState<TerminalViewStatus>("idle")
  const [sessionId, setSessionId] = useState<string | undefined>(
    payload.sessionId,
  )
  const [errorMessage, setErrorMessage] = useState<string | undefined>()
  const handleRef = useRef<TerminalSessionHandle | undefined>(undefined)
  const outputCbRef = useRef<((data: string) => void) | undefined>(undefined)
  const replayCbRef = useRef<((chunks: string[]) => void) | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (handleRef.current) {
        handleRef.current.close()
        handleRef.current = undefined
      }
    }
  }, [])

  const open = useCallback(async () => {
    setStatus("creating")
    setErrorMessage(undefined)

    try {
      const sessionId = payload.sessionId

      const events = {
        onReady: (id: string) => {
          setSessionId(id)
          setStatus("connected")
        },
        onOutput: (data: string) => {
          outputCbRef.current?.(data)
        },
        onExit: () => {
          setStatus("expired")
          handleRef.current = undefined
        },
        onError: (msg: string) => {
          setErrorMessage(msg)
          setStatus("error")
        },
        onReplay: (chunks: string[]) => {
          replayCbRef.current?.(chunks)
        },
      }

      const handle = sessionId
        ? await terminalConnectionManager.attachSession(sessionId, payload, events)
        : await terminalConnectionManager.createSession(payload, events, initialCols, initialRows)

      handleRef.current = handle
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to create terminal session"
      setErrorMessage(msg)
      setStatus("error")
    }
  }, [payload, initialCols, initialRows])

  const close = useCallback(() => {
    if (handleRef.current) {
      handleRef.current.close()
      handleRef.current = undefined
    }
    setStatus("idle")
    setSessionId(undefined)
    setErrorMessage(undefined)
  }, [])

  const sendInput = useCallback((data: string) => {
    handleRef.current?.sendInput(data)
  }, [])

  const sendResize = useCallback((cols: number, rows: number) => {
    handleRef.current?.sendResize(cols, rows)
  }, [])

  const onOutput = useCallback((cb: (data: string) => void) => {
    outputCbRef.current = cb
  }, [])

  const onReplay = useCallback((cb: (chunks: string[]) => void) => {
    replayCbRef.current = cb
  }, [])

  return {
    status,
    sessionId,
    errorMessage,
    open,
    close,
    sendInput,
    sendResize,
    onOutput,
    onReplay,
  }
}
