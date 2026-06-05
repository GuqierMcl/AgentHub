import { Hono, Context } from 'hono'
import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { config } from '../config'
import { logger } from '../lib/logger'
import type { RuntimeClient } from '../lib/runtime'

declare module 'hono' {
  interface ContextVariableMap {
    runtimeClient: RuntimeClient
  }
}

const SETTINGS_FILE = resolve(config.dataDir, 'setting.json')
const OLD_DIAGNOSTICS_FILE = resolve(config.dataDir, 'diagnostics.json')

const DEFAULT_SETTINGS = {
  diagnostics: {
    includeModelStream: true,
    includeReasoning: true,
    includeRawModelChunks: false,
  },
  editor: {
    fontSize: 14,
    fontFamily: '',
    tabSize: 2,
    wordWrap: 'off' as const,
    lineNumbers: 'on' as const,
    minimapEnabled: false,
    folding: true,
    renderWhitespace: 'selection' as const,
    codeBlockLineNumbers: false,
    maxPreviewFileSize: 512000,
    maxEditableFileSize: 1048576,
    maxLineCount: 20000,
    maxLineLength: 20000,
  },
  terminal: {
    fontSize: 13,
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
    cursorBlink: true,
    cursorStyle: 'bar' as const,
    maxSessions: 3,
    idleTimeoutMs: 300000,
    replayBufferBytes: 4194304,
    bashDefaultTimeoutMs: 30000,
    bashMaxOutputBytes: 131072,
    reconnectMaxAttempts: 3,
    reconnectDelaysMs: [1000, 2000, 3000],
  },
}

type FullSettings = typeof DEFAULT_SETTINGS

const DiagnosticsUpdateSchema = z.object({
  includeModelStream: z.boolean().optional(),
  includeReasoning: z.boolean().optional(),
  includeRawModelChunks: z.boolean().optional(),
})

const EditorUpdateSchema = z.object({
  fontSize: z.number().min(8).max(48).optional(),
  fontFamily: z.string().optional(),
  tabSize: z.union([z.literal(2), z.literal(4), z.literal(8)]).optional(),
  wordWrap: z.enum(['off', 'on', 'wordWrapColumn', 'bounded']).optional(),
  lineNumbers: z.enum(['on', 'off', 'relative', 'interval']).optional(),
  minimapEnabled: z.boolean().optional(),
  folding: z.boolean().optional(),
  renderWhitespace: z.enum(['none', 'boundary', 'selection', 'trailing', 'all']).optional(),
  codeBlockLineNumbers: z.boolean().optional(),
  maxPreviewFileSize: z.number().min(10240).max(52428800).optional(),
  maxEditableFileSize: z.number().min(10240).max(52428800).optional(),
  maxLineCount: z.number().min(100).max(200000).optional(),
  maxLineLength: z.number().min(100).max(200000).optional(),
})

const TerminalUpdateSchema = z.object({
  fontSize: z.number().min(8).max(48).optional(),
  fontFamily: z.string().optional(),
  cursorBlink: z.boolean().optional(),
  cursorStyle: z.enum(['block', 'underline', 'bar']).optional(),
  maxSessions: z.number().min(1).max(20).optional(),
  idleTimeoutMs: z.number().min(30000).max(3600000).optional(),
  replayBufferBytes: z.number().min(131072).max(52428800).optional(),
  bashDefaultTimeoutMs: z.number().min(5000).max(300000).optional(),
  bashMaxOutputBytes: z.number().min(10240).max(10485760).optional(),
  reconnectMaxAttempts: z.number().min(0).max(10).optional(),
  reconnectDelaysMs: z.array(z.number().min(100).max(30000)).optional(),
})

function migrateOldDiagnostics(): void {
  if (!existsSync(OLD_DIAGNOSTICS_FILE)) return
  try {
    const oldData = JSON.parse(readFileSync(OLD_DIAGNOSTICS_FILE, 'utf-8'))
    if (existsSync(SETTINGS_FILE)) {
      const settings = loadSettings()
      settings.diagnostics = { ...settings.diagnostics, ...oldData }
      writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8')
    } else {
      const settings = { ...DEFAULT_SETTINGS }
      settings.diagnostics = { ...settings.diagnostics, ...oldData }
      writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8')
    }
    unlinkSync(OLD_DIAGNOSTICS_FILE)
    logger.info({ from: OLD_DIAGNOSTICS_FILE, to: SETTINGS_FILE }, 'Migrated diagnostics.json to setting.json')
  } catch (err) {
    logger.warn({ err }, 'Failed to migrate diagnostics.json, creating fresh setting.json')
  }
}

function loadSettings(): FullSettings {
  migrateOldDiagnostics()

  if (!existsSync(SETTINGS_FILE)) {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
  }
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'))
    return deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), raw) as FullSettings
  } catch (err) {
    logger.warn({ err, file: SETTINGS_FILE }, 'Failed to load settings file, using defaults')
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
  }
}

function deepMerge(defaults: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(defaults)) {
    const dv = defaults[key]
    const ov = overrides[key]
    if (ov === undefined) {
      result[key] = dv
    } else if (isPlainObject(dv) && isPlainObject(ov)) {
      result[key] = deepMerge(dv as Record<string, unknown>, ov as Record<string, unknown>)
    } else {
      result[key] = ov
    }
  }
  return result
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function updateSection<K extends keyof FullSettings>(
  section: K,
  data: Record<string, unknown>,
): FullSettings {
  const settings = loadSettings()
  settings[section] = { ...settings[section], ...data } as FullSettings[K]
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8')
  return settings
}

function respondSection(c: Context, section: keyof FullSettings): Response {
  const settings = loadSettings()
  return c.json(settings[section])
}

const settings = new Hono()

settings.get('/api/settings/diagnostics', (c: Context) => {
  return respondSection(c, 'diagnostics')
})

settings.put('/api/settings/diagnostics', async (c: Context) => {
  const body = await c.req.json()
  const parsed = DiagnosticsUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      400,
    )
  }
  const updated = updateSection('diagnostics', parsed.data)
  return c.json(updated.diagnostics)
})

settings.get('/api/settings/editor', (c: Context) => {
  return respondSection(c, 'editor')
})

settings.put('/api/settings/editor', async (c: Context) => {
  const body = await c.req.json()
  const parsed = EditorUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      400,
    )
  }
  const updated = updateSection('editor', parsed.data)
  return c.json(updated.editor)
})

settings.get('/api/settings/terminal', (c: Context) => {
  return respondSection(c, 'terminal')
})

settings.put('/api/settings/terminal', async (c: Context) => {
  const body = await c.req.json()
  const parsed = TerminalUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      400,
    )
  }
  const updated = updateSection('terminal', parsed.data)
  return c.json(updated.terminal)
})

settings.get('/api/settings/model', async (c: Context) => {
  const client = c.get('runtimeClient')
  const { data, status } = await client.forward(
    'GET',
    '/runtime/settings/model',
    undefined,
    { raw: true },
  )
  return c.json(data, status as 200)
})

settings.put('/api/settings/model', async (c: Context) => {
  const client = c.get('runtimeClient')
  const body = await c.req.json().catch(() => null)
  const { data, status } = await client.forward(
    'PUT',
    '/runtime/settings/model',
    body,
    { raw: true },
  )
  return c.json(data, status as 200)
})

settings.delete('/api/settings/model', async (c: Context) => {
  const client = c.get('runtimeClient')
  const { data, status } = await client.forward(
    'DELETE',
    '/runtime/settings/model',
    undefined,
    { raw: true },
  )
  return c.json(data, status as 200)
})

export { loadSettings }
export default settings
