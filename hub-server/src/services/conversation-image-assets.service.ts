import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import { z } from 'zod'

import { config } from '../config'
import { AppError, badRequest, notFound } from '../lib/errors'

export const CONVERSATION_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const CONVERSATION_IMAGE_MAX_PER_MESSAGE = 8
export const CONVERSATION_IMAGE_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const

type ConversationImageMediaType = (typeof CONVERSATION_IMAGE_MEDIA_TYPES)[number]

export type ConversationImageAssetMetadata = {
  kind: 'image'
  assetId: string
  filename: string
  mediaType: ConversationImageMediaType
  size: number
  width?: number
  height?: number
  relativePath: string
  url: string
}

export type ConversationImageAssetFile = {
  filePath: string
  filename: string
  mediaType: ConversationImageMediaType
  size: number
  metadata: ConversationImageAssetMetadata
}

export type SaveConversationImageAssetInput = {
  conversationId: string
  fileName: string
  mediaType: string
  bytes: Uint8Array | Buffer
}

const mediaTypeSchema = z.enum(CONVERSATION_IMAGE_MEDIA_TYPES)
const metadataSchema = z.object({
  kind: z.literal('image'),
  assetId: z.string().min(1),
  filename: z.string().min(1),
  mediaType: mediaTypeSchema,
  size: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  relativePath: z.string().min(1),
  url: z.string().min(1),
})

const imageTypeBySharpFormat: Record<string, ConversationImageMediaType> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

const extensionByMediaType: Record<ConversationImageMediaType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export async function saveConversationImageAsset(
  input: SaveConversationImageAssetInput,
): Promise<ConversationImageAssetMetadata> {
  const bytes = Buffer.from(input.bytes)

  if (bytes.byteLength > CONVERSATION_IMAGE_MAX_BYTES) {
    throw new AppError(413, 'FILE_TOO_LARGE', 'Image upload exceeds the 10 MB limit')
  }

  const mediaType = parseMediaType(input.mediaType)
  const imageMetadata = await readImageMetadata(bytes, mediaType)
  const assetId = nanoid()
  const extension = extensionByMediaType[mediaType]
  const imagesRoot = getConversationImagesRoot(input.conversationId)
  const assetDir = resolve(imagesRoot, assetId)
  assertPathInside(imagesRoot, assetDir, 'IMAGE_ASSET_NOT_FOUND', 'Image asset was not found')

  const storedFileName = `original.${extension}`
  const filePath = resolve(assetDir, storedFileName)
  assertPathInside(assetDir, filePath, 'IMAGE_ASSET_NOT_FOUND', 'Image asset was not found')

  const relativePath = toDataDirRelativePath(filePath)
  const metadata: ConversationImageAssetMetadata = {
    kind: 'image',
    assetId,
    filename: sanitizeDisplayFilename(input.fileName),
    mediaType,
    size: bytes.byteLength,
    ...(typeof imageMetadata.width === 'number' ? { width: imageMetadata.width } : {}),
    ...(typeof imageMetadata.height === 'number' ? { height: imageMetadata.height } : {}),
    relativePath,
    url: `/api/conversations/${encodeURIComponent(input.conversationId)}/assets/images/${encodeURIComponent(assetId)}/file`,
  }

  await mkdir(assetDir, { recursive: true })
  await writeFile(filePath, bytes)
  await writeFile(resolve(assetDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')

  return metadata
}

export async function getConversationImageAsset(
  conversationId: string,
  assetId: string,
): Promise<ConversationImageAssetFile> {
  const imagesRoot = getConversationImagesRoot(conversationId)
  const assetDir = resolve(imagesRoot, assetId)
  if (!isPathInside(imagesRoot, assetDir)) {
    throw imageAssetNotFound()
  }

  const metadataPath = resolve(assetDir, 'metadata.json')
  if (!isPathInside(assetDir, metadataPath)) {
    throw imageAssetNotFound()
  }

  const metadata = await readMetadata(metadataPath, assetId)
  const filePath = resolve(config.dataDir, metadata.relativePath)
  if (!isPathInside(assetDir, filePath)) {
    throw imageAssetNotFound()
  }

  try {
    await access(filePath, constants.R_OK)
  } catch {
    throw imageAssetNotFound()
  }

  return {
    filePath,
    filename: metadata.filename,
    mediaType: metadata.mediaType,
    size: metadata.size,
    metadata,
  }
}

function parseMediaType(mediaType: string): ConversationImageMediaType {
  const normalized = mediaType.trim().toLowerCase()
  const result = mediaTypeSchema.safeParse(normalized)
  if (!result.success) {
    throw badRequest('INVALID_FILE_TYPE', 'Unsupported image file type')
  }
  return result.data
}

async function readImageMetadata(
  bytes: Buffer,
  mediaType: ConversationImageMediaType,
): Promise<{ width?: number; height?: number }> {
  try {
    const metadata = await sharp(bytes).metadata()
    const detectedMediaType = metadata.format
      ? imageTypeBySharpFormat[metadata.format]
      : undefined

    if (detectedMediaType !== mediaType) {
      throw new Error('Image bytes do not match declared media type')
    }

    return {
      width: metadata.width,
      height: metadata.height,
    }
  } catch {
    throw badRequest('INVALID_IMAGE_DATA', 'Invalid image data')
  }
}

async function readMetadata(
  metadataPath: string,
  assetId: string,
): Promise<ConversationImageAssetMetadata> {
  try {
    const raw = await readFile(metadataPath, 'utf8')
    const metadata = metadataSchema.parse(JSON.parse(raw))
    if (metadata.assetId !== assetId) {
      throw new Error('Asset metadata id mismatch')
    }
    return metadata
  } catch {
    throw imageAssetNotFound()
  }
}

function sanitizeDisplayFilename(fileName: string): string {
  const leafName = fileName.split(/[\\/]/).pop() ?? ''
  const sanitized = leafName
    .replace(/\0/g, '')
    .replace(/[\u0001-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (sanitized.length === 0) {
    return 'image'
  }

  return sanitized.slice(0, 255)
}

function getConversationImagesRoot(conversationId: string): string {
  const conversationAssetsRoot = resolve(config.dataDir, 'conversation-assets')
  const imagesRoot = resolve(conversationAssetsRoot, conversationId, 'images')
  assertPathInside(
    conversationAssetsRoot,
    imagesRoot,
    'INVALID_CONVERSATION_ID',
    'Invalid conversation id',
  )
  return imagesRoot
}

function toDataDirRelativePath(filePath: string): string {
  const relativePath = relative(resolve(config.dataDir), filePath)
  return relativePath.split(/[\\/]/).join('/')
}

function assertPathInside(parentPath: string, childPath: string, code: string, message: string): void {
  if (!isPathInside(parentPath, childPath)) {
    throw code === 'IMAGE_ASSET_NOT_FOUND'
      ? imageAssetNotFound()
      : badRequest(code, message)
  }
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const childRelativePath = relative(resolve(parentPath), resolve(childPath))
  return childRelativePath === ''
    || (
      childRelativePath !== '..'
      && !childRelativePath.startsWith(`..${sep}`)
      && !isAbsolute(childRelativePath)
    )
}

function imageAssetNotFound() {
  return notFound('IMAGE_ASSET_NOT_FOUND', 'Image asset was not found')
}
