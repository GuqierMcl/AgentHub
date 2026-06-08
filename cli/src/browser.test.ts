import { describe, expect, it } from "bun:test"
import { getOpenBrowserCommand } from "./browser"

describe("getOpenBrowserCommand", () => {
  it("uses cmd start on Windows", () => {
    expect(getOpenBrowserCommand("http://127.0.0.1:3000", "win32")).toEqual([
      "cmd",
      "/c",
      "start",
      "",
      "http://127.0.0.1:3000",
    ])
  })

  it("uses open on macOS", () => {
    expect(getOpenBrowserCommand("http://127.0.0.1:3000", "darwin")).toEqual([
      "open",
      "http://127.0.0.1:3000",
    ])
  })

  it("uses xdg-open on Linux", () => {
    expect(getOpenBrowserCommand("http://127.0.0.1:3000", "linux")).toEqual([
      "xdg-open",
      "http://127.0.0.1:3000",
    ])
  })
})
