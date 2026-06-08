import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ExternalAgentSettingsStore } from "./external-agent-settings-store"

const tempDirs: string[] = []

async function createTempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "agenthub-external-agent-settings-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("ExternalAgentSettingsStore", () => {
  test("returns empty settings when no settings file exists", async () => {
    const dataDir = await createTempDataDir()
    const store = new ExternalAgentSettingsStore(dataDir)

    await expect(store.loadSettings()).resolves.toEqual({})
  })

  test("saves and reloads provider-specific settings with versioned raw file", async () => {
    const dataDir = await createTempDataDir()
    const store = new ExternalAgentSettingsStore(dataDir)

    await store.saveSettings({
      opencode: {
        provider: "opencode",
        model: {
          providerID: "anthropic",
          modelID: "claude-sonnet-4",
        },
        executionAgent: "build",
        updatedAt: "2026-06-08T00:00:00.000Z",
      },
      "claude-code": {
        provider: "claude-code",
        model: "claude-sonnet-4",
        permissionMode: "acceptEdits",
        updatedAt: "2026-06-08T00:01:00.000Z",
      },
      codex: {
        provider: "codex",
        model: "gpt-5",
        updatedAt: "2026-06-08T00:02:00.000Z",
      },
    })

    await expect(store.loadSettings()).resolves.toEqual({
      opencode: {
        provider: "opencode",
        model: {
          providerID: "anthropic",
          modelID: "claude-sonnet-4",
        },
        executionAgent: "build",
        updatedAt: "2026-06-08T00:00:00.000Z",
      },
      "claude-code": {
        provider: "claude-code",
        model: "claude-sonnet-4",
        permissionMode: "acceptEdits",
        updatedAt: "2026-06-08T00:01:00.000Z",
      },
      codex: {
        provider: "codex",
        model: "gpt-5",
        updatedAt: "2026-06-08T00:02:00.000Z",
      },
    })

    const raw = JSON.parse(await readFile(join(dataDir, "external-agent-settings.json"), "utf-8"))
    expect(raw.version).toBe(1)
  })

  test("drops invalid settings while preserving valid entries", async () => {
    const dataDir = await createTempDataDir()
    const store = new ExternalAgentSettingsStore(dataDir)
    await writeFile(
      join(dataDir, "external-agent-settings.json"),
      JSON.stringify({
        version: 1,
        settings: {
          opencode: {
            provider: "opencode",
            model: {
              providerID: "",
              modelID: "qwen3-coder",
            },
          },
          codex: {
            provider: "codex",
            model: "gpt-5",
          },
        },
      }),
      "utf-8"
    )

    await expect(store.loadSettings()).resolves.toEqual({
      codex: {
        provider: "codex",
        model: "gpt-5",
      },
    })
  })
})
