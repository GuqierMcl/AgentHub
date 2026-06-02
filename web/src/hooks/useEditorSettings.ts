import { useState, useEffect } from "react"
import { settingsApi, type EditorSettings } from "@/features/settings/api/settings-api"

const defaults: EditorSettings = {
  fontSize: 14,
  fontFamily: "",
  tabSize: 2,
  wordWrap: "off",
  lineNumbers: "on",
  minimapEnabled: false,
  folding: true,
  renderWhitespace: "selection",
  codeBlockLineNumbers: false,
  maxPreviewFileSize: 512000,
  maxEditableFileSize: 1048576,
  maxLineCount: 20000,
  maxLineLength: 20000,
}

let cached: EditorSettings | null = null
let fetchPromise: Promise<EditorSettings> | null = null

export function useEditorSettings(): EditorSettings {
  const [settings, setSettings] = useState<EditorSettings>(() => cached ?? defaults)

  useEffect(() => {
    if (cached) return

    if (!fetchPromise) {
      fetchPromise = settingsApi.fetchEditor()
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
