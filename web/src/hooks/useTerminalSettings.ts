import { useState, useEffect } from "react"
import { settingsApi, type TerminalSettings } from "@/features/settings/api/settings-api"

const defaults: TerminalSettings = {
  fontSize: 13,
  fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
  cursorBlink: true,
  cursorStyle: "bar",
  maxSessions: 3,
  idleTimeoutMs: 300000,
  replayBufferBytes: 4194304,
  bashDefaultTimeoutMs: 30000,
  bashMaxOutputBytes: 131072,
  reconnectMaxAttempts: 3,
  reconnectDelaysMs: [1000, 2000, 3000],
}

let cached: TerminalSettings | null = null
let fetchPromise: Promise<TerminalSettings> | null = null

export function useTerminalSettings(): TerminalSettings {
  const [settings, setSettings] = useState<TerminalSettings>(() => cached ?? defaults)

  useEffect(() => {
    if (cached) return

    if (!fetchPromise) {
      fetchPromise = settingsApi.fetchTerminal()
        .then((data) => {
          cached = { ...defaults, ...data }
          return cached
        })
        .catch(() => {
          cached = { ...defaults }
          return cached
        })
        .finally(() => {
          fetchPromise = null
        })
    }

    let cancelled = false
    fetchPromise.then((data) => {
      if (!cancelled) setSettings(data)
    })
    return () => { cancelled = true }
  }, [])

  return settings
}
