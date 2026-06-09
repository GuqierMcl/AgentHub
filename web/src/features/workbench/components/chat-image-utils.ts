import type { FileUIPart } from "ai"

import type { ChatImageAttachmentInput } from "../types"

export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const CHAT_IMAGE_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp,image/gif"

const SUPPORTED_CHAT_IMAGE_MEDIA_TYPES = new Set(
  CHAT_IMAGE_UPLOAD_ACCEPT.split(",")
)

export function isSupportedChatImageFilePart(
  filePart: Pick<FileUIPart, "mediaType">
): filePart is ChatImageAttachmentInput {
  return SUPPORTED_CHAT_IMAGE_MEDIA_TYPES.has(filePart.mediaType.toLowerCase())
}
