import { describe, expect, it } from "bun:test"
import { createCliBuildCommand } from "../scripts/build"

describe("CLI build command", () => {
  it("embeds the AgentHub icon in compiled Windows launchers", () => {
    const buildCommand = createCliBuildCommand("win32")

    expect(buildCommand).toContain("--windows-icon")
    expect(buildCommand).toContain("../desktop/assets/icon.ico")
  })

  it("does not pass Windows-only icon flags on macOS", () => {
    const buildCommand = createCliBuildCommand("darwin")

    expect(buildCommand).not.toContain("--windows-icon")
    expect(buildCommand).not.toContain("../desktop/assets/icon.ico")
  })

  it("does not pass Windows-only icon flags on Linux", () => {
    const buildCommand = createCliBuildCommand("linux")

    expect(buildCommand).not.toContain("--windows-icon")
    expect(buildCommand).not.toContain("../desktop/assets/icon.ico")
  })
})
