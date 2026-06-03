import { Hono, Context } from 'hono'
import { existsSync, writeFileSync, unlinkSync, createReadStream, copyFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { z } from 'zod'
import type { RuntimeClient } from '../lib/runtime'
import { badRequest, notFound } from '../lib/errors'
import type { Logger } from 'pino'
import {
  loadManifest,
  setAgentOverride,
  deleteAgentOverride,
  getAgentFileDir,
  ensureAgentFileDir,
  ensureHistoryDir,
  addHistoryEntry,
  removeHistoryEntry,
  getHistoryEntries,
  updateImageOverrideFile,
  AVATAR_DIR,
  MAX_HISTORY,
  type AvatarOverrideTone,
  type AvatarOverrideShape,
  type AvatarOverrideHistoryEntry,
} from '../lib/avatar-overrides-store'
import {
  isAllowedImageType,
  AVATAR_MAX_SIZE,
  processBitmap,
  sanitizeAndSaveSvg,
} from '../lib/avatar-image-processor'

declare module 'hono' {
  interface ContextVariableMap {
    runtimeClient: RuntimeClient
    logger: Logger
  }
}

const ALLOWED_ICONS = [
  'bot', 'code2', 'search', 'eye', 'pen-line', 'shield-check', 'route',
  'list-checks', 'file-text', 'image', 'music', 'video', 'globe',
  'database', 'cloud', 'server', 'book-open', 'message-square',
  'sparkles', 'zap', 'brain', 'cog', 'users', 'user',
  'wand-sparkles', 'blocks', 'workflow', 'git-branch',
] as const

const IconOverrideSchema = z.object({
  source: z.literal('icon'),
  icon: z.enum(ALLOWED_ICONS),
  tone: z.enum(['amber', 'blue', 'emerald', 'rose', 'slate', 'teal', 'violet'] as const),
})

const InitialsOverrideSchema = z.object({
  source: z.literal('initials'),
  text: z.string().min(1).max(2),
  tone: z.enum(['amber', 'blue', 'emerald', 'rose', 'slate', 'teal', 'violet'] as const),
  shape: z.enum(['circle', 'rounded'] as const),
})

const OverrideBodySchema = z.discriminatedUnion('source', [IconOverrideSchema, InitialsOverrideSchema])

async function validateAgentId(agentId: string, runtimeClient: RuntimeClient, logger: Logger): Promise<void> {
  if (!agentId) throw badRequest('INVALID_AGENT_ID', 'agentId is required')
  try {
    const { status } = await runtimeClient.forward(
      'GET', `/runtime/agents/${encodeURIComponent(agentId)}`,
      undefined, { raw: true },
    )
    if (status === 404) throw notFound('AGENT_NOT_FOUND', `Agent "${agentId}" not found`)
    if (status !== 200) throw badRequest('AGENT_CHECK_FAILED', `Failed to verify agent "${agentId}"`)
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'RUNTIME_NOT_READY') {
      logger.warn({ agentId }, 'Runtime not available, allowing avatar override without agent validation')
      return
    }
    throw err
  }
}

function getImageFilePath(agentId: string, mimeType: string): string {
  return resolve(getAgentFileDir(agentId), `current.${mimeType === 'image/svg+xml' ? 'svg' : 'webp'}`)
}

const avatarOverrides = new Hono()

avatarOverrides.get('/api/avatar-overrides', (c: Context) => {
  const manifest = loadManifest()
  return c.json({
    version: manifest.version,
    updatedAt: manifest.updatedAt,
    agents: manifest.agents,
  })
})

avatarOverrides.get('/api/avatar-overrides/:agentId', (c: Context) => {
  const manifest = loadManifest()
  const override = manifest.agents[c.req.param('agentId')!]
  return c.json(override ?? null)
})

avatarOverrides.put('/api/avatar-overrides/:agentId', async (c: Context) => {
  const agentId = c.req.param('agentId')!
  const runtimeClient = c.get('runtimeClient')
  const logger = c.get('logger')

  await validateAgentId(agentId, runtimeClient, logger)

  const body = await c.req.json()
  const parsed = OverrideBodySchema.safeParse(body)
  if (!parsed.success) {
    throw badRequest('VALIDATION_ERROR', parsed.error.message)
  }

  setAgentOverride(agentId, parsed.data)
  logger.info({ agentId, source: parsed.data.source }, 'Avatar override set')

  return c.json({ success: true })
})

avatarOverrides.post('/api/avatar-overrides/:agentId/image', async (c: Context) => {
  const agentId = c.req.param('agentId')!
  const runtimeClient = c.get('runtimeClient')
  const logger = c.get('logger')

  await validateAgentId(agentId, runtimeClient, logger)

  const formData = await c.req.parseBody()
  const file = formData['file']

  if (!file || !(file instanceof File)) {
    throw badRequest('MISSING_FILE', 'No file uploaded')
  }

  if (file.size > AVATAR_MAX_SIZE) {
    throw badRequest('FILE_TOO_LARGE', `File size exceeds ${AVATAR_MAX_SIZE / 1024 / 1024}MB limit`)
  }

  const mimeType = file.type || 'application/octet-stream'
  if (!isAllowedImageType(mimeType)) {
    throw badRequest('INVALID_FILE_TYPE', `Unsupported file type: ${mimeType}`)
  }

  const outputDir = ensureAgentFileDir(agentId)
  const isSvg = mimeType === 'image/svg+xml'
  const ext = isSvg ? 'svg' : 'webp'
  const tempPath = resolve(outputDir, `upload-temp${isSvg ? '.svg' : '.bin'}`)

  const buffer = Buffer.from(await file.arrayBuffer())
  writeFileSync(tempPath, buffer)

  let dimensions: { width: number; height: number; size: number }

  try {
    if (isSvg) {
      dimensions = sanitizeAndSaveSvg(tempPath, outputDir)
    } else {
      dimensions = await processBitmap(tempPath, outputDir)
    }
  } finally {
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath) } catch { /* ignore */ }
    }
  }

  const outputMimeType = isSvg ? 'image/svg+xml' : 'image/webp'

  const currentPath = resolve(outputDir, `current.${ext}`)
  const existingOverride = loadManifest().agents[agentId]

  if (existingOverride?.source === 'image' && existsSync(currentPath)) {
    const historyDir = ensureHistoryDir(agentId)
    const historyId = `his_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const historyExt = existingOverride.file.mimeType === 'image/svg+xml' ? 'svg' : 'webp'
    const historyFilename = `${historyId}.${historyExt}`
    const historyPath = resolve(historyDir, historyFilename)
    copyFileSync(currentPath, historyPath)

    addHistoryEntry(agentId, {
      id: historyId,
      relativePath: `files/${agentId}/history/${historyFilename}`,
      mimeType: existingOverride.file.mimeType,
      width: existingOverride.file.width,
      height: existingOverride.file.height,
      size: existingOverride.file.size,
      createdAt: new Date().toISOString(),
    })
  }

  setAgentOverride(agentId, {
    source: 'image',
    file: {
      relativePath: `files/${agentId}/current.${ext}`,
      mimeType: outputMimeType,
      width: dimensions.width,
      height: dimensions.height,
      size: dimensions.size,
    },
  })

  logger.info({ agentId, mimeType, width: dimensions.width, height: dimensions.height }, 'Avatar image uploaded')

  return c.json({ success: true })
})

avatarOverrides.delete('/api/avatar-overrides/:agentId', (c: Context) => {
  const agentId = c.req.param('agentId')!
  const logger = c.get('logger')

  deleteAgentOverride(agentId)
  logger.info({ agentId }, 'Avatar override deleted')

  return c.json({ success: true })
})

avatarOverrides.get('/api/avatar-overrides/:agentId/file', (c: Context) => {
  const agentId = c.req.param('agentId')!
  const manifest = loadManifest()
  const override = manifest.agents[agentId]

  if (!override || override.source !== 'image') {
    throw notFound('NOT_IMAGE_TYPE', 'Agent does not have an image avatar override')
  }

  const filePath = getImageFilePath(agentId, override.file.mimeType)

  if (!existsSync(filePath)) {
    throw notFound('FILE_NOT_FOUND', 'Avatar image file not found')
  }

  const stream = createReadStream(filePath)
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': override.file.mimeType,
      'Cache-Control': 'public, max-age=3600',
    },
  })
})

avatarOverrides.get('/api/avatar-overrides/:agentId/history', (c: Context) => {
  const agentId = c.req.param('agentId')!
  const history = getHistoryEntries(agentId)
  return c.json(history)
})

avatarOverrides.delete('/api/avatar-overrides/:agentId/history/:historyId', (c: Context) => {
  const agentId = c.req.param('agentId')!
  const historyId = c.req.param('historyId')!
  const removed = removeHistoryEntry(agentId, historyId)
  if (!removed) {
    throw notFound('HISTORY_NOT_FOUND', 'History entry not found')
  }
  return c.json({ success: true })
})

avatarOverrides.get('/api/avatar-overrides/:agentId/history/:historyId/file', (c: Context) => {
  const agentId = c.req.param('agentId')!
  const historyId = c.req.param('historyId')!
  const history = getHistoryEntries(agentId)
  const entry = history.find(h => h.id === historyId)

  if (!entry) {
    throw notFound('HISTORY_NOT_FOUND', 'History entry not found')
  }

  const filePath = resolve(AVATAR_DIR, entry.relativePath)

  if (!existsSync(filePath)) {
    throw notFound('FILE_NOT_FOUND', 'History avatar image file not found')
  }

  const stream = createReadStream(filePath)
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': entry.mimeType,
      'Cache-Control': 'public, max-age=3600',
    },
  })
})

avatarOverrides.put('/api/avatar-overrides/:agentId/history/:historyId/restore', (c: Context) => {
  const agentId = c.req.param('agentId')!
  const historyId = c.req.param('historyId')!
  const logger = c.get('logger')
  const history = getHistoryEntries(agentId)
  const entry = history.find(h => h.id === historyId)

  if (!entry) {
    throw notFound('HISTORY_NOT_FOUND', 'History entry not found')
  }

  const entryPath = resolve(AVATAR_DIR, entry.relativePath)
  if (!existsSync(entryPath)) {
    throw notFound('FILE_NOT_FOUND', 'History avatar image file not found')
  }

  const outputDir = ensureAgentFileDir(agentId)
  const currentExt = entry.mimeType === 'image/svg+xml' ? 'svg' : 'webp'
  const currentPath = resolve(outputDir, `current.${currentExt}`)

  if (existsSync(currentPath)) {
    const historyDir = ensureHistoryDir(agentId)
    const snapshotId = `his_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const snapshotFilename = `${snapshotId}.${currentExt}`
    const snapshotPath = resolve(historyDir, snapshotFilename)
    const currentOverride = loadManifest().agents[agentId]

    let snapshotMimeType = entry.mimeType
    let snapshotWidth = entry.width
    let snapshotHeight = entry.height
    let snapshotSize = entry.size

    if (currentOverride?.source === 'image' && existsSync(currentPath)) {
      copyFileSync(currentPath, snapshotPath)
      snapshotMimeType = currentOverride.file.mimeType
      snapshotWidth = currentOverride.file.width
      snapshotHeight = currentOverride.file.height
      snapshotSize = currentOverride.file.size

      addHistoryEntry(agentId, {
        id: snapshotId,
        relativePath: `files/${agentId}/history/${snapshotFilename}`,
        mimeType: snapshotMimeType,
        width: snapshotWidth,
        height: snapshotHeight,
        size: snapshotSize,
        createdAt: new Date().toISOString(),
      })
    }
  }

  copyFileSync(entryPath, currentPath)

  updateImageOverrideFile(agentId, {
    relativePath: `files/${agentId}/current.${currentExt}`,
    mimeType: entry.mimeType,
    width: entry.width,
    height: entry.height,
    size: entry.size,
  })

  removeHistoryEntry(agentId, historyId)

  logger.info({ agentId, historyId }, 'Avatar restored from history')
  return c.json({ success: true })
})

export default avatarOverrides
