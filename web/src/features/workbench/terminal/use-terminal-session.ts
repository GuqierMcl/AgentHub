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
  const openRequestIdRef = useRef(0)
  const unmountedRef = useRef(false)

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    unmountedRef.current = false

    return () => {
      unmountedRef.current = true
      openRequestIdRef.current += 1
      if (handleRef.current) {
        handleRef.current.disconnect()
        handleRef.current = undefined
      }
    }
  }, [])

  const open = useCallback(async () => {
    const requestId = openRequestIdRef.current + 1
    openRequestIdRef.current = requestId

    setStatus("creating")
    setErrorMessage(undefined)

    try {
      const activeSessionId = sessionIdRef.current ?? payload.sessionId
      const shouldCreateSession = !activeSessionId

      const events = {
        onReady: (id: string) => {
          if (
            unmountedRef.current ||
            openRequestIdRef.current !== requestId
          ) {
            return
          }
          sessionIdRef.current = id
          setSessionId(id)
          setStatus("connected")
        },
        onOutput: (data: string) => {
          if (
            unmountedRef.current ||
            openRequestIdRef.current !== requestId
          ) {
            return
          }
          outputCbRef.current?.(data)
        },
        onConnecting: () => {
          if (
            unmountedRef.current ||
            openRequestIdRef.current !== requestId
          ) {
            return
          }
          setStatus("connecting")
        },
        onReconnecting: () => {
          if (
            unmountedRef.current ||
            openRequestIdRef.current !== requestId
          ) {
            return
          }
          setStatus("reconnecting")
        },
        onExit: () => {
          if (
            unmountedRef.current ||
            openRequestIdRef.current !== requestId
          ) {
            return
          }
          setStatus("expired")
          handleRef.current = undefined
        },
        onError: (msg: string) => {
          if (
            unmountedRef.current ||
            openRequestIdRef.current !== requestId
          ) {
            return
          }
          setErrorMessage(msg)
          setStatus("error")
        },
        onReplay: (chunks: string[]) => {
          if (
            unmountedRef.current ||
            openRequestIdRef.current !== requestId
          ) {
            return
          }
          replayCbRef.current?.(chunks)
        },
      }

      const handle = activeSessionId
        ? await terminalConnectionManager.attachSession(activeSessionId, payload, events)
        : await terminalConnectionManager.createSession(payload, events, initialCols, initialRows)

      if (
        unmountedRef.current ||
        openRequestIdRef.current !== requestId
      ) {
        if (shouldCreateSession) {
          handle.destroy()
        } else {
          handle.disconnect()
        }
        return
      }

      sessionIdRef.current = handle.sessionId
      handleRef.current = handle
    } catch (err) {
      if (
        unmountedRef.current ||
        openRequestIdRef.current !== requestId
      ) {
        return
      }
      const msg =
        err instanceof Error ? err.message : "Failed to create terminal session"
      setErrorMessage(msg)
      setStatus("error")
    }
  }, [payload, initialCols, initialRows])

  const disconnect = useCallback(() => {
    openRequestIdRef.current += 1
    if (handleRef.current) {
      handleRef.current.disconnect()
      handleRef.current = undefined
    }
  }, [])

  const destroy = useCallback(() => {
    openRequestIdRef.current += 1
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
    unmountedRef.current = false
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
