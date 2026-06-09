import { describe, expect, it } from "bun:test"

import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_UPLOAD_ACCEPT,
  isSupportedChatImageFilePart,
} from "./ChatComposer"

describe("ChatComposer image attachment constraints", () => {
  it("matches the server-side image media type and size contract", () => {
    expect(CHAT_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024)
    expect(CHAT_IMAGE_UPLOAD_ACCEPT).toBe("image/png,image/jpeg,image/webp,image/gif")
    expect(isSupportedChatImageFilePart({ mediaType: "image/png" })).toBe(true)
    expect(isSupportedChatImageFilePart({ mediaType: "image/jpeg" })).toBe(true)
    expect(isSupportedChatImageFilePart({ mediaType: "image/webp" })).toBe(true)
    expect(isSupportedChatImageFilePart({ mediaType: "image/gif" })).toBe(true)
    expect(isSupportedChatImageFilePart({ mediaType: "image/svg+xml" })).toBe(false)
    expect(isSupportedChatImageFilePart({ mediaType: "image/avif" })).toBe(false)
  })
})
