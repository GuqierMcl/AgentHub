import { describe, expect, it } from "bun:test"

import {
  derivePreviewTabFallbackTitle,
  resolvePreviewTabTitle,
} from "./preview-tab-title"

describe("preview tab title", () => {
  it("falls back to hostname when the page title is unavailable", () => {
    expect(
      derivePreviewTabFallbackTitle(
        "https://www.baidu.com/s?wd=%E6%80%BB%E4%B9%A6%E8%AE%B0"
      )
    ).toBe("www.baidu.com")
  })

  it("prefers the trimmed page title when available", () => {
    expect(
      resolvePreviewTabTitle(
        "https://www.baidu.com/s?wd=%E6%80%BB%E4%B9%A6%E8%AE%B0",
        "  百度一下，你就知道  "
      )
    ).toBe("百度一下，你就知道")
  })
})
