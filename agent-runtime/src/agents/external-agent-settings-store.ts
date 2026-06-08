import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import {
  ClaudeCodeExternalAgentSettingsSchema,
  CodexExternalAgentSettingsSchema,
  ExternalAgentSettingsMapSchema,
  OpenCodeExternalAgentSettingsSchema,
  type ExternalAgentId,
  type ExternalAgentSettingsMap,
} from "./types"

const SETTINGS_FILE_NAME = "external-agent-settings.json"

const ExternalAgentSettingsFileSchema = z.object({
  version: z.literal(1),
  settings: z.unknown(),
}).strip()

const providerSchemas = {
  opencode: OpenCodeExternalAgentSettingsSchema,
  "claude-code": ClaudeCodeExternalAgentSettingsSchema,
  codex: CodexExternalAgentSettingsSchema,
} as const

const externalAgentIds: ExternalAgentId[] = ["opencode", "claude-code", "codex"]

export class ExternalAgentSettingsStore {
  private readonly settingsPath: string

  constructor(private readonly dataDir: string) {
    this.settingsPath = join(dataDir, SETTINGS_FILE_NAME)
  }

  async loadSettings(): Promise<ExternalAgentSettingsMap> {
    let content: string
    try {
      content = await readFile(this.settingsPath, "utf-8")
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return {}
      }
      console.warn(`Ignoring unreadable external agent settings file at ${this.settingsPath}:`, error)
      return {}
    }

    try {
      const parsed = JSON.parse(content)
      const fileResult = ExternalAgentSettingsFileSchema.safeParse(parsed)
      if (!fileResult.success) {
        console.warn(`Ignoring invalid external agent settings file at ${this.settingsPath}:`, fileResult.error)
        return {}
      }

      const mapResult = ExternalAgentSettingsMapSchema.safeParse(fileResult.data.settings)
      if (mapResult.success) {
        return mapResult.data
      }

      return this.loadValidEntries(fileResult.data.settings)
    } catch (error) {
      console.warn(`Ignoring invalid external agent settings file at ${this.settingsPath}:`, error)
      return {}
    }
  }

  async saveSettings(settings: ExternalAgentSettingsMap): Promise<void> {
    const parsed = ExternalAgentSettingsMapSchema.parse(settings)
    await mkdir(this.dataDir, { recursive: true })
    await writeFile(
      this.settingsPath,
      `${JSON.stringify({ version: 1, settings: parsed }, null, 2)}\n`,
      "utf-8"
    )
  }

  private loadValidEntries(value: unknown): ExternalAgentSettingsMap {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {}
    }

    const record = value as Record<string, unknown>
    const validEntries: ExternalAgentSettingsMap = {}

    for (const agentId of externalAgentIds) {
      const result = providerSchemas[agentId].safeParse(record[agentId])
      if (result.success) {
        validEntries[agentId] = result.data as never
      }
    }

    return validEntries
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
