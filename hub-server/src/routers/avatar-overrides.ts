import { Hono, Context } from 'hono'
import { existsSync, writeFileSync, unlinkSync, createReadStream, readdirSync, statSync } from 'node:fs'
import { resolve, extname, relative } from 'node:path'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import type { RuntimeClient } from '../lib/runtime'
import { badRequest, notFound } from '../lib/errors'
import type { Logger } from 'pino'
import {
  loadManifest,
  setAgentOverride,
  deleteAgentOverride,
  saveManifest,
  getAgentFileDir,
  ensureAgentFileDir,
  AVATAR_DIR,
  FILES_DIR,
  type AvatarOverrideTone,
  type AvatarOverrideShape,
  type AvatarOverrideImageFile,
} from '../lib/avatar-overrides-store'
import {
  isAllowedImageType,
  AVATAR_MAX_SIZE,
  AVATAR_TARGET_SIZE,
  processBitmap,
  sanitizeAndSaveSvg,
  extensionToMimeType,
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
  const ext = isSvg ? '.svg' : '.webp'
  const outputFilename = `${nanoid(12)}${ext}`
  const tempExt = isSvg ? '.svg' : '.bin'
  const tempPath = resolve(outputDir, `upload-temp${tempExt}`)

  const buffer = Buffer.from(await file.arrayBuffer())
  writeFileSync(tempPath, buffer)

  let dimensions: { width: number; height: number; size: number }

  try {
    if (isSvg) {
      dimensions = sanitizeAndSaveSvg(tempPath, outputDir, outputFilename)
    } else {
      dimensions = await processBitmap(tempPath, outputDir, outputFilename)
    }
  } finally {
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath) } catch { /* ignore */ }
    }
  }

  const outputMimeType = isSvg ? 'image/svg+xml' : 'image/webp'
  setAgentOverride(agentId, {
    source: 'image',
    file: {
      relativePath: `files/${agentId}/${outputFilename}`,
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

async function getFileMetadata(filePath: string, mimeType: string): Promise<Pick<AvatarOverrideImageFile, 'width' | 'height' | 'size'>> {
  const stat = statSync(filePath)
  if (mimeType === 'image/svg+xml') {
    return { width: AVATAR_TARGET_SIZE, height: AVATAR_TARGET_SIZE, size: stat.size }
  }
  const meta = await sharp(filePath).metadata()
  return {
    width: meta.width ?? AVATAR_TARGET_SIZE,
    height: meta.height ?? AVATAR_TARGET_SIZE,
    size: stat.size,
  }
}

avatarOverrides.get('/api/avatar-overrides/:agentId/file', (c: Context) => {
  const agentId = c.req.param('agentId')!
  const manifest = loadManifest()
  const override = manifest.agents[agentId]

  if (!override || override.source !== 'image') {
    throw notFound('NOT_IMAGE_TYPE', 'Agent does not have an image avatar override')
  }

  const filePath = resolve(AVATAR_DIR, override.file.relativePath)

  if (!existsSync(filePath)) {
    deleteAgentOverride(agentId)
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

avatarOverrides.get('/api/avatar-overrides/:agentId/library', (c: Context) => {
  const agentId = c.req.param('agentId')!
  const agentDir = getAgentFileDir(agentId)

  if (!existsSync(agentDir)) {
    return c.json([])
  }

  const manifest = loadManifest()
  const currentRelative = manifest.agents[agentId]?.source === 'image'
    ? manifest.agents[agentId].file.relativePath
    : null

  const files = readdirSync(agentDir).filter((name) => {
    const ext = extname(name).toLowerCase()
    return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)
  })

  const items = files.map((filename) => {
    const filePath = resolve(agentDir, filename)
    const stat = statSync(filePath)
    const mimeType = extensionToMimeType(filename) ?? 'application/octet-stream'
    const relativePath = `files/${agentId}/${filename}`
    return {
      filename,
      mimeType,
      size: stat.size,
      createdAt: stat.birthtime.toISOString(),
      isCurrent: relativePath === currentRelative,
    }
  })

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  return c.json(items)
})

avatarOverrides.get('/api/avatar-overrides/:agentId/library/:filename', (c: Context) => {
  const agentId = c.req.param('agentId')!
  const filename = c.req.param('filename')!

  const filePath = resolve(getAgentFileDir(agentId), filename)

  if (!existsSync(filePath)) {
    throw notFound('FILE_NOT_FOUND', 'Library file not found')
  }

  const mimeType = extensionToMimeType(filename) ?? 'application/octet-stream'
  const stream = createReadStream(filePath)
  return new Response(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=3600',
    },
  })
})

avatarOverrides.delete('/api/avatar-overrides/:agentId/library/:filename', (c: Context) => {
  const agentId = c.req.param('agentId')!
  const filename = c.req.param('filename')!
  const logger = c.get('logger')

  const filePath = resolve(getAgentFileDir(agentId), filename)

  if (!existsSync(filePath)) {
    throw notFound('FILE_NOT_FOUND', 'Library file not found')
  }

  unlinkSync(filePath)
  logger.info({ agentId, filename }, 'Avatar library file deleted')

  const manifest = loadManifest()
  const currentOverride = manifest.agents[agentId]
  if (currentOverride?.source === 'image') {
    const expectedRelative = `files/${agentId}/${filename}`
    if (currentOverride.file.relativePath === expectedRelative) {
      delete manifest.agents[agentId]
      saveManifest(manifest)
      logger.info({ agentId }, 'Cleared avatar override because current image was deleted')
    }
  }

  return c.json({ success: true })
})

avatarOverrides.put('/api/avatar-overrides/:agentId/library/:filename/activate', async (c: Context) => {
  const agentId = c.req.param('agentId')!
  const filename = c.req.param('filename')!
  const logger = c.get('logger')

  const filePath = resolve(getAgentFileDir(agentId), filename)

  if (!existsSync(filePath)) {
    throw notFound('FILE_NOT_FOUND', 'Library file not found')
  }

  const mimeType = extensionToMimeType(filename) ?? 'application/octet-stream'
  const metadata = await getFileMetadata(filePath, mimeType)

  const relativePath = `files/${agentId}/${filename}`
  setAgentOverride(agentId, {
    source: 'image',
    file: {
      relativePath,
      mimeType: mimeType,
      width: metadata.width,
      height: metadata.height,
      size: metadata.size,
    },
  })

  logger.info({ agentId, filename }, 'Avatar activated from library')

  return c.json({ success: true })
})

export default avatarOverrides
