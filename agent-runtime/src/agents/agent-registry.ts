import { AgentStore } from "./agent-store"
import { presetAgents, presetAgentRelations } from "./preset-agents"
import { presetSubagents } from "./preset-subagents"
import type {
  AgentDefinition,
  AgentListOptions,
  AgentRelation,
  AgentRelationListOptions,
} from "./types"

export class AgentRegistry {
  private store: AgentStore
  private agents: Map<string, AgentDefinition> = new Map()
  private relations: Map<string, AgentRelation> = new Map()
  private systemAgentIds: Set<string> = new Set()
  private initialized = false

  constructor(dataDir: string) {
    this.store = new AgentStore(dataDir)
    this.loadPresets()
  }

  async initialize(): Promise<void> {
    const userAgents = await this.store.loadAgents()
    const userRelations = await this.store.loadRelations()

    for (const agent of userAgents) {
      if (this.systemAgentIds.has(agent.id)) {
        console.warn(`Ignoring user agent "${agent.id}" because it conflicts with a system preset`)
        continue
      }
      this.agents.set(agent.id, agent)
    }

    for (const relation of userRelations) {
      this.relations.set(relation.id, relation)
    }

    this.validateDefaultEntryAgent()
    this.initialized = true
  }

  isInitialized(): boolean {
    return this.initialized
  }

  listAgents(options: AgentListOptions = {}): AgentDefinition[] {
    const includeHidden = options.includeHidden ?? false
    const enabledOnly = options.enabledOnly ?? true

    return Array.from(this.agents.values())
      .filter((agent) => includeHidden || agent.visibility === "visible")
      .filter((agent) => !enabledOnly || agent.enabled)
      .filter((agent) => !options.tier || agent.tier === options.tier)
      .filter((agent) => !options.origin || agent.origin === options.origin)
  }

  getAgent(agentId: string): AgentDefinition | null {
    return this.agents.get(agentId) ?? null
  }

  listCallablePrimaryAgents(): AgentDefinition[] {
    return this.listAgents({ includeHidden: false, enabledOnly: true, tier: "primary" })
      .filter((agent) => agent.entryPolicy === "callable" || agent.entryPolicy === "default")
  }

  listRelations(options: AgentRelationListOptions = {}): AgentRelation[] {
    const enabledOnly = options.enabledOnly ?? true

    return Array.from(this.relations.values())
      .filter((relation) => !enabledOnly || relation.enabled)
      .filter((relation) => !options.fromAgentId || relation.fromAgentId === options.fromAgentId)
      .filter((relation) => !options.toAgentId || relation.toAgentId === options.toAgentId)
  }

  getDefaultEntryAgent(): AgentDefinition | null {
    const defaults = this.listAgents({ includeHidden: false, enabledOnly: true, tier: "primary" })
      .filter((agent) => agent.entryPolicy === "default")

    if (defaults.length !== 1) {
      console.warn(`Expected exactly one default entry agent, found ${defaults.length}`)
      return null
    }

    return defaults[0]
  }

  private loadPresets(): void {
    for (const agent of [...presetAgents, ...presetSubagents]) {
      this.agents.set(agent.id, agent)
      this.systemAgentIds.add(agent.id)
    }

    for (const relation of presetAgentRelations) {
      this.relations.set(relation.id, relation)
    }
  }

  private validateDefaultEntryAgent(): void {
    this.getDefaultEntryAgent()
  }
}

