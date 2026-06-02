export type DiagnosticsSettings = {
  includeModelStream: boolean
  includeReasoning: boolean
  includeRawModelChunks: boolean
}

export type EditorSettings = {
  fontSize: number
  fontFamily: string
  tabSize: 2 | 4 | 8
  wordWrap: "off" | "on" | "wordWrapColumn" | "bounded"
  lineNumbers: "on" | "off" | "relative" | "interval"
  minimapEnabled: boolean
  folding: boolean
  renderWhitespace: "none" | "boundary" | "selection" | "trailing" | "all"
  codeBlockLineNumbers: boolean
  maxPreviewFileSize: number
  maxEditableFileSize: number
  maxLineCount: number
  maxLineLength: number
}

export type TerminalSettings = {
  fontSize: number
  fontFamily: string
  cursorBlink: boolean
  cursorStyle: "block" | "underline" | "bar"
  maxSessions: number
  idleTimeoutMs: number
  replayBufferBytes: number
  bashDefaultTimeoutMs: number
  bashMaxOutputBytes: number
  reconnectMaxAttempts: number
  reconnectDelaysMs: number[]
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`)
  return res.json()
}

async function putJson<T>(url: string, data: Partial<T>): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`Failed to update: ${res.status}`)
  return res.json()
}

export const settingsApi = {
  fetchDiagnostics: () => fetchJson<DiagnosticsSettings>("/api/settings/diagnostics"),
  updateDiagnostics: (data: Partial<DiagnosticsSettings>) =>
    putJson<DiagnosticsSettings>("/api/settings/diagnostics", data),

  fetchEditor: () => fetchJson<EditorSettings>("/api/settings/editor"),
  updateEditor: (data: Partial<EditorSettings>) =>
    putJson<EditorSettings>("/api/settings/editor", data),

  fetchTerminal: () => fetchJson<TerminalSettings>("/api/settings/terminal"),
  updateTerminal: (data: Partial<TerminalSettings>) =>
    putJson<TerminalSettings>("/api/settings/terminal", data),
}
