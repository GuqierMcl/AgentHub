import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"

const CLI_ROOT = resolve(import.meta.dir, "..")

describe("CLI build command", () => {
  it("embeds the AgentHub icon in compiled Windows launchers", async () => {
    const packageJson = JSON.parse(
      await readFile(join(CLI_ROOT, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> }

    const buildCommand = packageJson.scripts?.build ?? ""

    expect(buildCommand).toContain("--windows-icon")
    expect(buildCommand).toContain("../desktop/assets/icon.ico")
  })
})
