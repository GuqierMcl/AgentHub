import { Hono, Context } from 'hono'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { config } from '../config'
import { logger } from '../lib/logger'

const DIAGNOSTICS_FILE = resolve(config.dataDir, 'diagnostics.json')

const DEFAULT_DIAGNOSTICS = {
  includeModelStream: true,
  includeReasoning: true,
  includeRawModelChunks: false,
}

const UpdateDiagnosticsSchema = z.object({
  includeModelStream: z.boolean().optional(),
  includeReasoning: z.boolean().optional(),
  includeRawModelChunks: z.boolean().optional(),
})

function loadDiagnostics() {
  if (!existsSync(DIAGNOSTICS_FILE)) {
    return { ...DEFAULT_DIAGNOSTICS }
  }
  try {
    return { ...DEFAULT_DIAGNOSTICS, ...JSON.parse(readFileSync(DIAGNOSTICS_FILE, 'utf-8')) }
  } catch (err) {
    logger.warn({ err, file: DIAGNOSTICS_FILE }, 'Failed to load diagnostics file, using defaults')
    return { ...DEFAULT_DIAGNOSTICS }
  }
}

function saveDiagnostics(data: Record<string, unknown>) {
  const current = loadDiagnostics()
  const merged = { ...current, ...data }
  writeFileSync(DIAGNOSTICS_FILE, JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

const settings = new Hono()

settings.get('/api/settings/diagnostics', (c: Context) => {
  return c.json(loadDiagnostics())
})

settings.put('/api/settings/diagnostics', async (c: Context) => {
  const body = await c.req.json()
  const parsed = UpdateDiagnosticsSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: parsed.error.message } },
      400,
    )
  }
  const updated = saveDiagnostics(parsed.data)
  return c.json(updated)
})

export default settings
