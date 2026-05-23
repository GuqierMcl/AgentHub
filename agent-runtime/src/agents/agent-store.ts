import { existsSync } from "node:fs"
import { join } from "node:path"
import { readFile } from "node:fs/promises"
import {
  AgentDefinitionListSchema,
  AgentRelationListSchema,
  type AgentDefinition,
  type AgentRelation,
} from "./types"

export class AgentStore {
  private agentsPath: string
  private relationsPath: string

  constructor(dataDir: string) {
    this.agentsPath = join(dataDir, "agents.json")
    this.relationsPath = join(dataDir, "agent-relations.json")
  }

  async loadAgents(): Promise<AgentDefinition[]> {
    return this.loadJsonArray(this.agentsPath, AgentDefinitionListSchema, "agents")
  }

  async loadRelations(): Promise<AgentRelation[]> {
    return this.loadJsonArray(this.relationsPath, AgentRelationListSchema, "agent relations")
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

