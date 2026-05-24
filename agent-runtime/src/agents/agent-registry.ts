import { AgentStore } from "./agent-store"
import { AgentModelBindingStore } from "./agent-model-binding-store"
import { presetAgents, presetAgentRelations } from "./preset-agents"
import { presetSubagents } from "./preset-subagents"
import type {
  AgentDefinition,
  AgentModelBindingMap,
  AgentModelRef,
  AgentListOptions,
  AgentRelation,
  AgentRelationListOptions,
} from "./types"

export class AgentRegistry {
  private store: AgentStore
  private bindingStore: AgentModelBindingStore
  private baseAgents: Map<string, AgentDefinition> = new Map()
  private agents: Map<string, AgentDefinition> = new Map()
  private relations: Map<string, AgentRelation> = new Map()
  private systemAgentIds: Set<string> = new Set()
  private modelBindings: AgentModelBindingMap = {}
  private initialized = false

  constructor(dataDir: string) {
    this.store = new AgentStore(dataDir)
    this.bindingStore = new AgentModelBindingStore(dataDir)
    this.loadPresets()
  }

  async initialize(): Promise<void> {
    const userAgents = await this.store.loadAgents()
    const userRelations = await this.store.loadRelations()
    this.modelBindings = await this.bindingStore.loadBindings()

    for (const agent of userAgents) {
      if (this.systemAgentIds.has(agent.id)) {
        console.warn(`Ignoring user agent "${agent.id}" because it conflicts with a system preset`)
        continue
      }
      this.baseAgents.set(agent.id, this.cloneAgent(agent))
      this.agents.set(agent.id, this.applyModelBinding(agent))
    }

    for (const relation of userRelations) {
      this.relations.set(relation.id, relation)
    }

    this.applyBindingsToRegisteredAgents()
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

  isModelBindingAllowed(agentId: string): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) {
      return false
    }

    return this.canBindModel(agent)
  }

  async setAgentModelBinding(agentId: string, modelRef: AgentModelRef): Promise<AgentDefinition | null> {
    const agent = this.agents.get(agentId)
    if (!agent) {
      return null
    }

    if (!this.canBindModel(agent)) {
      return null
    }

    const baseAgent = this.baseAgents.get(agentId) ?? agent
    const normalizedModelRef = this.cloneModelRef(modelRef)

    if (this.isSameModelRef(baseAgent.modelRef, normalizedModelRef)) {
      delete this.modelBindings[agentId]
    } else {
      this.modelBindings[agentId] = normalizedModelRef
    }

    const updated = this.applyModelBinding(baseAgent, normalizedModelRef)
    updated.updatedAt = new Date().toISOString()
    this.agents.set(agentId, updated)
    await this.bindingStore.saveBindings(this.modelBindings)
    return updated
  }

  async clearAgentModelBinding(agentId: string): Promise<AgentDefinition | null> {
    const agent = this.agents.get(agentId)
    if (!agent) {
      return null
    }

    if (!this.canBindModel(agent)) {
      return null
    }

    delete this.modelBindings[agentId]
    const baseAgent = this.baseAgents.get(agentId) ?? agent
    const updated = this.applyModelBinding(baseAgent)
    updated.updatedAt = new Date().toISOString()
    this.agents.set(agentId, updated)
    await this.bindingStore.saveBindings(this.modelBindings)
    return updated
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
      const clonedAgent = this.cloneAgent(agent)
      this.baseAgents.set(agent.id, clonedAgent)
      this.agents.set(agent.id, this.cloneAgent(clonedAgent))
      this.systemAgentIds.add(agent.id)
    }

    for (const relation of presetAgentRelations) {
      this.relations.set(relation.id, relation)
    }
  }

  private validateDefaultEntryAgent(): void {
    this.getDefaultEntryAgent()
  }

  private applyBindingsToRegisteredAgents(): void {
    for (const [agentId, binding] of Object.entries(this.modelBindings)) {
      const baseAgent = this.baseAgents.get(agentId)
      if (!baseAgent) {
        console.warn(`Ignoring model binding for unknown agent "${agentId}"`)
        delete this.modelBindings[agentId]
        continue
      }

      const updated = this.applyModelBinding(baseAgent, binding)
      this.agents.set(agentId, updated)
    }
  }

  private applyModelBinding(agent: AgentDefinition, modelRef?: AgentModelRef): AgentDefinition {
    const cloned = this.cloneAgent(agent)
    if (modelRef) {
      cloned.modelRef = this.cloneModelRef(modelRef)
    } else if (cloned.id in this.modelBindings) {
      const binding = this.modelBindings[cloned.id]
      if (binding) {
        cloned.modelRef = this.cloneModelRef(binding)
      } else {
        delete cloned.modelRef
      }
    } else if (cloned.modelRef) {
      cloned.modelRef = this.cloneModelRef(cloned.modelRef)
    }

    return cloned
  }

  private canBindModel(agent: AgentDefinition): boolean {
    return (
      agent.tier === "primary" &&
      agent.visibility === "visible" &&
      agent.enabled &&
      agent.origin !== "external" &&
      (agent.executorType === "ai-sdk" || agent.executorType === "orchestrator")
    )
  }

  private isSameModelRef(left?: AgentModelRef, right?: AgentModelRef): boolean {
    if (!left || !right) {
      return left === right
    }

    return left.providerId === right.providerId && left.modelId === right.modelId
  }

  private cloneAgent(agent: AgentDefinition): AgentDefinition {
    return structuredClone(agent)
  }

  private cloneModelRef(modelRef: AgentModelRef): AgentModelRef {
    return {
      providerId: modelRef.providerId,
      modelId: modelRef.modelId,
    }
  }
}

