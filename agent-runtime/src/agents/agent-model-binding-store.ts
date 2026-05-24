import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { readFile, writeFile } from "node:fs/promises"
import {
  AgentModelBindingMapSchema,
  type AgentModelBindingMap,
  type AgentModelRef,
} from "./types"

export class AgentModelBindingStore {
  private bindingsPath: string

  constructor(dataDir: string) {
    this.bindingsPath = join(dataDir, "agent-model-bindings.json")
  }

  async loadBindings(): Promise<AgentModelBindingMap> {
    if (!existsSync(this.bindingsPath)) {
      return {}
    }

    try {
      const content = await readFile(this.bindingsPath, "utf-8")
      const parsed = JSON.parse(content)
      const result = AgentModelBindingMapSchema.safeParse(parsed)
      if (!result.success) {
        console.warn(`Ignoring invalid agent model binding file at ${this.bindingsPath}:`, result.error)
        return {}
      }

      return result.data
    } catch (error) {
      console.warn(`Ignoring unreadable agent model binding file at ${this.bindingsPath}:`, error)
      return {}
    }
  }

  async saveBindings(bindings: AgentModelBindingMap): Promise<void> {
    try {
      const dataDir = this.getDataDir()
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true })
      }

      const sortedBindings = Object.fromEntries(
        Object.entries(bindings).sort(([left], [right]) => left.localeCompare(right))
      )
      await writeFile(this.bindingsPath, JSON.stringify(sortedBindings, null, 2), "utf-8")
    } catch (error) {
      console.warn(`Failed to save agent model binding file at ${this.bindingsPath}:`, error)
    }
  }

  private getDataDir(): string {
    return dirname(this.bindingsPath)
  }
}
