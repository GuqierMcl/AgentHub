import { useCallback, useEffect, useRef, useState } from "react"

import type { TerminalTabPayload } from "@/store/tab-store"
import { terminalApi } from "../api/terminal"

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
  disconnect: () => void
  destroy: () => void
  recreate: () => Promise<void>
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
  const sessionIdRef = useRef<string | undefined>(payload.sessionId)
  const outputCbRef = useRef<((data: string) => void) | undefined>(undefined)
  const replayCbRef = useRef<((chunks: string[]) => void) | undefined>(undefined)

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    return () => {
      if (handleRef.current) {
        handleRef.current.disconnect()
        handleRef.current = undefined
      }
    }
  }, [])

  const open = useCallback(async () => {
    setStatus("creating")
    setErrorMessage(undefined)

    try {
      const activeSessionId = sessionIdRef.current ?? payload.sessionId

      const events = {
        onReady: (id: string) => {
          sessionIdRef.current = id
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

      const handle = activeSessionId
        ? await terminalConnectionManager.attachSession(activeSessionId, payload, events)
        : await terminalConnectionManager.createSession(payload, events, initialCols, initialRows)

      sessionIdRef.current = handle.sessionId
      handleRef.current = handle
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to create terminal session"
      setErrorMessage(msg)
      setStatus("error")
    }
  }, [payload, initialCols, initialRows])

  const disconnect = useCallback(() => {
    if (handleRef.current) {
      handleRef.current.disconnect()
      handleRef.current = undefined
    }
  }, [])

  const destroy = useCallback(() => {
    if (handleRef.current) {
      handleRef.current.destroy()
      handleRef.current = undefined
    } else if (sessionIdRef.current) {
      terminalApi.closeSession(payload.conversationId, sessionIdRef.current).catch(() => {})
    }
    sessionIdRef.current = undefined
    setStatus("idle")
    setSessionId(undefined)
    setErrorMessage(undefined)
  }, [payload.conversationId])

  const recreate = useCallback(async () => {
    destroy()
    await open()
  }, [destroy, open])

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
    disconnect,
    destroy,
    recreate,
    sendInput,
    sendResize,
    onOutput,
    onReplay,
  }
}
