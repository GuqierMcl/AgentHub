import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import sharp from 'sharp'

import { config } from '../config'
import { closeDatabase, initDatabase } from '../lib/db'
import { errorHandler } from '../lib/errors'
import { createConversation, deleteConversationById } from '../repositories/conversation.repo'
import { CONVERSATION_IMAGE_MAX_BYTES } from '../services/conversation-image-assets.service'
import { prepareTestDatabase } from '../test-utils/database'
import conversationAssetsRouter from './conversation-assets'

const originalDataDir = config.dataDir
let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'hub-server-conversation-assets-router-'))
  config.dataDir = tempDir
  const dbPath = join(tempDir, 'hub.db').replace(/\\/g, '/')
  const dbUrl = `file:${dbPath}`
  prepareTestDatabase(dbUrl)
  await initDatabase(dbUrl)
}, 30_000)

afterAll(async () => {
  await closeDatabase()
  config.dataDir = originalDataDir
  if (tempDir) {
    await removeTempDirWithRetry(tempDir)
  }
}, 30_000)

function createApp(): Hono {
  const app = new Hono()
  app.onError(errorHandler)
  app.route('/', conversationAssetsRouter)
  return app
}

describe('conversation assets router', () => {
  it('uploads an image asset and returns public metadata', async () => {
    const app = createApp()
    const conversation = await createConversation({
      title: 'Image upload',
      mode: 'single',
    })
    const bytes = await createPngBytes(7, 5)
    const formData = new FormData()
    formData.append('file', createImageFile(bytes, 'photo.png'))

    const response = await app.request(
      `/api/conversations/${conversation.id}/assets/images`,
      { method: 'POST', body: formData },
    )
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(201)
    expect(body).toMatchObject({
      kind: 'image',
      filename: 'photo.png',
      mediaType: 'image/png',
      size: bytes.length,
      width: 7,
      height: 5,
    })
    expect(typeof body.assetId).toBe('string')
    expect(body.url).toBe(
      `/api/conversations/${encodeURIComponent(conversation.id)}/assets/images/${encodeURIComponent(body.assetId as string)}/file`,
    )
    expect(body).not.toHaveProperty('relativePath')
  })

  it('returns MISSING_FILE when multipart file is absent', async () => {
    const app = createApp()
    const conversation = await createConversation({
      title: 'Missing file',
      mode: 'single',
    })
    const formData = new FormData()
    formData.append('file', 'not-a-file')

    const response = await app.request(
      `/api/conversations/${conversation.id}/assets/images`,
      { method: 'POST', body: formData },
    )
    const body = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(400)
    expect(body.error?.code).toBe('MISSING_FILE')
  })

  it('rejects oversized image upload bodies before parsing multipart data', async () => {
    const app = createApp()
    const conversation = await createConversation({
      title: 'Oversized body',
      mode: 'single',
    })
    const bytes = await createPngBytes(2, 2)
    const formData = new FormData()
    formData.append('file', createImageFile(bytes, 'small.png'))

    const response = await app.request(
      `/api/conversations/${conversation.id}/assets/images`,
      {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Length': String(CONVERSATION_IMAGE_MAX_BYTES + 128 * 1024),
        },
      },
    )
    const body = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(413)
    expect(body.error?.code).toBe('FILE_TOO_LARGE')
    expect(existsSync(join(tempDir, 'conversation-assets', conversation.id))).toBe(false)
  })

  it('returns CONVERSATION_NOT_FOUND before writing an asset for a missing conversation', async () => {
    const app = createApp()
    const missingConversationId = 'conv_missing_asset_upload'
    const bytes = await createPngBytes(2, 2)
    const formData = new FormData()
    formData.append('file', createImageFile(bytes, 'missing-conversation.png'))

    const response = await app.request(
      `/api/conversations/${missingConversationId}/assets/images`,
      { method: 'POST', body: formData },
    )
    const body = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(404)
    expect(body.error?.code).toBe('CONVERSATION_NOT_FOUND')
    expect(existsSync(join(tempDir, 'conversation-assets', missingConversationId))).toBe(false)
  })

  it('streams an uploaded image file with private immutable cache headers', async () => {
    const app = createApp()
    const conversation = await createConversation({
      title: 'Stream image',
      mode: 'single',
    })
    const bytes = await createPngBytes(4, 3)
    const formData = new FormData()
    formData.append('file', createImageFile(bytes, 'stream.png'))
    const uploadResponse = await app.request(
      `/api/conversations/${conversation.id}/assets/images`,
      { method: 'POST', body: formData },
    )
    const uploaded = await uploadResponse.json() as { url: string }

    const response = await app.request(uploaded.url)
    const streamedBytes = Buffer.from(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect([...streamedBytes]).toEqual([...bytes])
  })

  it('returns CONVERSATION_NOT_FOUND instead of serving a leftover asset after conversation deletion', async () => {
    const app = createApp()
    const conversation = await createConversation({
      title: 'Deleted conversation asset',
      mode: 'single',
    })
    const bytes = await createPngBytes(3, 3)
    const formData = new FormData()
    formData.append('file', createImageFile(bytes, 'leftover.png'))
    const uploadResponse = await app.request(
      `/api/conversations/${conversation.id}/assets/images`,
      { method: 'POST', body: formData },
    )
    const uploaded = await uploadResponse.json() as { url: string }

    await deleteConversationById(conversation.id)

    const response = await app.request(uploaded.url)
    if (response.status !== 404) {
      await response.arrayBuffer()
    }

    expect(response.status).toBe(404)
    const body = await response.json() as { error?: { code?: string } }
    expect(body.error?.code).toBe('CONVERSATION_NOT_FOUND')
  })

  it('returns IMAGE_ASSET_NOT_FOUND for a missing image file asset', async () => {
    const app = createApp()
    const conversation = await createConversation({
      title: 'Missing asset',
      mode: 'single',
    })

    const response = await app.request(
      `/api/conversations/${conversation.id}/assets/images/missing_asset/file`,
    )
    const body = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(404)
    expect(body.error?.code).toBe('IMAGE_ASSET_NOT_FOUND')
  })
})

async function createPngBytes(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 24, g: 120, b: 210, alpha: 1 },
    },
  }).png().toBuffer()
}

function createImageFile(bytes: Buffer, name: string): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' })
}

async function removeTempDirWithRetry(dir: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true })
      return
    } catch (err) {
      lastError = err
      await sleep(100 * (attempt + 1))
    }
  }

  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
