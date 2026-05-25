import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import {
  AgentDefinitionListSchema,
  type AgentDefinition,
} from "./types"

export class AgentStore {
  private agentsPath: string

  constructor(dataDir: string) {
    this.agentsPath = join(dataDir, "agents.json")
  }

  async loadAgents(): Promise<AgentDefinition[]> {
    return this.loadJsonArray(this.agentsPath, AgentDefinitionListSchema, "agents")
  }

  async saveAgents(agents: AgentDefinition[]): Promise<void> {
    const sortedAgents = [...agents].sort((left, right) => left.id.localeCompare(right.id))
    const dir = dirname(this.agentsPath)
    const tempPath = `${this.agentsPath}.${process.pid}.${Date.now()}.tmp`

    await mkdir(dir, { recursive: true })
    await writeFile(tempPath, `${JSON.stringify(sortedAgents, null, 2)}\n`, "utf-8")
    await rename(tempPath, this.agentsPath)
  }

  private async loadJsonArray<T>(
    path: string,
    schema: { safeParse: (value: unknown) => { success: true; data: T[] } | { success: false; error: unknown } },
    label: string
  ): Promise<T[]> {
    if (!existsSync(path)) {
      return []
    }

    try {
      const content = await readFile(path, "utf-8")
      const parsed = JSON.parse(content)
      const result = schema.safeParse(parsed)
      if (!result.success) {
        console.warn(`Ignoring invalid ${label} file at ${path}:`, result.error)
        return []
      }
      return result.data
    } catch (error) {
      console.warn(`Ignoring unreadable ${label} file at ${path}:`, error)
      return []
    }
  }
}

