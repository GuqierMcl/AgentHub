import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

import { config } from '../config'
import { AppError } from '../lib/errors'
import {
  CONVERSATION_IMAGE_MAX_BYTES,
  getConversationImageAsset,
  saveConversationImageAsset,
} from './conversation-image-assets.service'

const originalDataDir = config.dataDir
let tempDir: string | undefined

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'hub-server-image-assets-'))
  config.dataDir = tempDir
})

afterEach(async () => {
  config.dataDir = originalDataDir
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

describe('conversation image asset service', () => {
  it('stores a PNG upload, writes metadata, and returns dimensions and URL', async () => {
    const bytes = await createPngBytes(4, 3)

    const metadata = await saveConversationImageAsset({
      conversationId: 'conversation-1',
      fileName: 'C:\\fakepath\\sample image.png',
      mediaType: 'image/png',
      bytes,
    })

    expect(metadata).toMatchObject({
      kind: 'image',
      filename: 'sample image.png',
      mediaType: 'image/png',
      size: bytes.length,
      width: 4,
      height: 3,
      relativePath: `conversation-assets/conversation-1/images/${metadata.assetId}/original.png`,
      url: `/api/conversations/conversation-1/assets/images/${encodeURIComponent(metadata.assetId)}/file`,
    })

    const assetDir = join(
      tempDir!,
      'conversation-assets',
      'conversation-1',
      'images',
      metadata.assetId,
    )
    await expect(readFile(join(assetDir, 'original.png'))).resolves.toEqual(bytes)
    await expect(readFile(join(assetDir, 'metadata.json'), 'utf8')).resolves.toBe(
      `${JSON.stringify(metadata, null, 2)}\n`,
    )
  })

  it('rejects SVG media type', async () => {
    await expectAppError(
      saveConversationImageAsset({
        conversationId: 'conversation-1',
        fileName: 'vector.svg',
        mediaType: 'image/svg+xml',
        bytes: Buffer.from('<svg></svg>'),
      }),
      'INVALID_FILE_TYPE',
    )
  })

  it('rejects oversized uploads', async () => {
    await expectAppError(
      saveConversationImageAsset({
        conversationId: 'conversation-1',
        fileName: 'huge.png',
        mediaType: 'image/png',
        bytes: new Uint8Array(CONVERSATION_IMAGE_MAX_BYTES + 1),
      }),
      'FILE_TOO_LARGE',
      413,
    )
  })

  it('rejects invalid bytes with an allowed media type', async () => {
    await expectAppError(
      saveConversationImageAsset({
        conversationId: 'conversation-1',
        fileName: 'not-a-png.png',
        mediaType: 'image/png',
        bytes: Buffer.from('not an image'),
      }),
      'INVALID_IMAGE_DATA',
    )
  })

  it('reads an image asset by assetId with file and media metadata', async () => {
    const bytes = await createPngBytes(2, 5)
    const metadata = await saveConversationImageAsset({
      conversationId: 'conversation-1',
      fileName: 'readback.png',
      mediaType: 'image/png',
      bytes,
    })

    const asset = await getConversationImageAsset('conversation-1', metadata.assetId)

    expect(asset).toEqual({
      filePath: join(
        tempDir!,
        'conversation-assets',
        'conversation-1',
        'images',
        metadata.assetId,
        'original.png',
      ),
      filename: 'readback.png',
      mediaType: 'image/png',
      size: bytes.length,
      metadata,
    })
  })

  it('returns IMAGE_ASSET_NOT_FOUND for a missing asset', async () => {
    await expectAppError(
      getConversationImageAsset('conversation-1', 'missing-asset'),
      'IMAGE_ASSET_NOT_FOUND',
    )
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

async function expectAppError(
  promise: Promise<unknown>,
  code: string,
  status?: AppError['status'],
): Promise<void> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe(code)
    if (status !== undefined) {
      expect((err as AppError).status).toBe(status)
    }
    return
  }

  throw new Error(`Expected AppError ${code}`)
}
