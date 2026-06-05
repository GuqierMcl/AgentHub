import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { logger } from "../lib/logger"
import { InstructLastPromptService } from "./instruct-last-prompt.service"

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

function createService() {
  const dir = mkdtempSync(join(tmpdir(), "instruct-last-prompt-"))
  tempDirs.push(dir)
  const filePath = join(dir, "instruct-last-prompt.json")
  return {
    filePath,
    service: new InstructLastPromptService(filePath),
  }
}

describe("InstructLastPromptService", () => {
  it("returns empty snapshot when file does not exist", () => {
    const { service } = createService()

    expect(service.get()).toEqual({
      prompt: null,
      updatedAt: null,
    })
  })

  it("trims and saves prompt content", () => {
    const { filePath, service } = createService()

    const snapshot = service.save("  create a reviewer agent  ")
    const stored = JSON.parse(readFileSync(filePath, "utf8")) as {
      lastPrompt: string
      updatedAt: string
    }

    expect(snapshot.prompt).toBe("create a reviewer agent")
    expect(typeof snapshot.updatedAt).toBe("string")
    expect(Number.isNaN(Date.parse(snapshot.updatedAt!))).toBe(false)
    expect(stored.lastPrompt).toBe("create a reviewer agent")
    expect(stored.updatedAt).toBe(snapshot.updatedAt!)
  })

  it("returns empty snapshot when file contains invalid json", () => {
    const originalWarn = logger.warn.bind(logger)
    logger.warn = () => {}

    const { filePath, service } = createService()
    writeFileSync(filePath, "{not-json", "utf8")

    expect(service.get()).toEqual({
      prompt: null,
      updatedAt: null,
    })

    logger.warn = originalWarn
  })
})
