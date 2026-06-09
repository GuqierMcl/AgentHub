import { createReadStream } from 'node:fs'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import { badRequest, notFound } from '../lib/errors'
import { findConversationById } from '../repositories/conversation.repo'
import {
  CONVERSATION_IMAGE_MAX_BYTES,
  getConversationImageAsset,
  saveConversationImageAsset,
  type ConversationImageAssetMetadata,
} from '../services/conversation-image-assets.service'

type PublicConversationImageAssetMetadata = Omit<ConversationImageAssetMetadata, 'relativePath'>

const CONVERSATION_IMAGE_MULTIPART_OVERHEAD_BYTES = 64 * 1024
const CONVERSATION_IMAGE_UPLOAD_BODY_MAX_BYTES =
  CONVERSATION_IMAGE_MAX_BYTES + CONVERSATION_IMAGE_MULTIPART_OVERHEAD_BYTES

const conversationAssets = new Hono()

conversationAssets.post('/api/conversations/:conversationId/assets/images', bodyLimit({
  maxSize: CONVERSATION_IMAGE_UPLOAD_BODY_MAX_BYTES,
  onError: (c) => c.json({
    error: {
      code: 'FILE_TOO_LARGE',
      message: 'Image upload exceeds the 10 MB limit',
    },
  }, 413),
}), async (c: Context) => {
  const conversationId = c.req.param('conversationId')!
  const body = await c.req.parseBody()
  const file = body.file

  if (!file || !(file instanceof File)) {
    throw badRequest('MISSING_FILE', 'No file uploaded')
  }

  const conversation = await findConversationById(conversationId)
  if (!conversation) {
    throw notFound('CONVERSATION_NOT_FOUND', 'Conversation was not found')
  }

  const metadata = await saveConversationImageAsset({
    conversationId,
    fileName: file.name,
    mediaType: file.type || 'application/octet-stream',
    bytes: Buffer.from(await file.arrayBuffer()),
  })

  return c.json(toPublicImageAssetMetadata(metadata), 201)
})

conversationAssets.get('/api/conversations/:conversationId/assets/images/:assetId/file', async (c: Context) => {
  const conversationId = c.req.param('conversationId')!
  const assetId = c.req.param('assetId')!
  const conversation = await findConversationById(conversationId)
  if (!conversation) {
    throw notFound('CONVERSATION_NOT_FOUND', 'Conversation was not found')
  }

  const asset = await getConversationImageAsset(conversationId, assetId)
  const stream = createReadStream(asset.filePath)

  return new Response(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': asset.mediaType,
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
})

function toPublicImageAssetMetadata(
  metadata: ConversationImageAssetMetadata,
): PublicConversationImageAssetMetadata {
  return {
    kind: metadata.kind,
    assetId: metadata.assetId,
    filename: metadata.filename,
    mediaType: metadata.mediaType,
    size: metadata.size,
    ...(metadata.width !== undefined ? { width: metadata.width } : {}),
    ...(metadata.height !== undefined ? { height: metadata.height } : {}),
    url: metadata.url,
  }
}

export default conversationAssets
