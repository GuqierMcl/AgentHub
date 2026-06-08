import { AgentStore } from "./agent-store"
import { AgentModelBindingStore } from "./agent-model-binding-store"
import { presetAgents } from "./preset-agents"
import { presetSubagents } from "./preset-subagents"
import {
  DEFAULT_USER_AGENT_PERMISSION_POLICY,
} from "./types"
import type {
  AgentDefinition,
  AgentModelBindingMap,
  AgentModelRef,
  AgentListOptions,
  AgentPermissionPolicy,
  AgentToolPermissionRules,
  AgentToolAuthoringCatalog,
  UserAgentCreateRequest,
  UserAgentUpdateRequest,
} from "./types"

const FILESYSTEM_PERMISSION_RANK = {
  none: 0,
  read: 1,
  write: 2,
} as const

const IMPLICIT_AI_SDK_TOOLS = ["question"] as const

export class AgentRegistryMutationError extends Error {
  constructor(
    public code:
      | "AGENT_INVALID_INPUT"
      | "AGENT_ALREADY_EXISTS"
      | "AGENT_NOT_EDITABLE"
      | "AGENT_STORE_WRITE_FAILED",
    message: string,
    public status: 400 | 403 | 409 | 500,
    public details?: unknown
  ) {
    super(message)
    this.name = "AgentRegistryMutationError"
  }
}

export class AgentRegistry {
  private store: AgentStore
  private bindingStore: AgentModelBindingStore
  private baseAgents: Map<string, AgentDefinition> = new Map()
  private agents: Map<string, AgentDefinition> = new Map()
  private systemAgentIds: Set<string> = new Set()
  private modelBindings: AgentModelBindingMap = {}
  private writeQueue: Promise<unknown> = Promise.resolve()
  private initialized = false

  constructor(dataDir: string, private toolCatalog: AgentToolAuthoringCatalog) {
    this.store = new AgentStore(dataDir)
    this.bindingStore = new AgentModelBindingStore(dataDir)
    this.loadPresets()
  }

  async initialize(): Promise<void> {
    const userAgents = await this.store.loadAgents()
    this.modelBindings = await this.bindingStore.loadBindings()

    for (const agent of userAgents) {
      if (this.systemAgentIds.has(agent.id)) {
        console.warn(`Ignoring user agent "${agent.id}" because it conflicts with a system preset`)
        continue
      }
      const normalizedAgent = this.normalizeLoadedUserAgent(agent)
      if (!normalizedAgent) {
        continue
      }
      this.baseAgents.set(normalizedAgent.id, this.cloneAgent(normalizedAgent))
      this.agents.set(normalizedAgent.id, this.applyModelBinding(normalizedAgent))
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

  async syncPersistedUserAgent(agent: AgentDefinition): Promise<AgentDefinition | null> {
    return this.serializeMutation(async () => {
      if (this.systemAgentIds.has(agent.id)) {
        return null
      }

      const normalizedAgent = this.normalizeLoadedUserAgent(agent)
      if (!normalizedAgent) {
        return null
      }

      this.baseAgents.set(normalizedAgent.id, this.cloneAgent(normalizedAgent))
      this.agents.set(normalizedAgent.id, this.applyModelBinding(normalizedAgent))
      return this.cloneAgent(this.agents.get(normalizedAgent.id) ?? normalizedAgent)
    })
  }

  async createUserAgent(input: UserAgentCreateRequest): Promise<AgentDefinition> {
    return this.serializeMutation(async () => {
      const now = new Date().toISOString()
      const agentId = input.id ?? `agent_${crypto.randomUUID()}`

      if (this.agents.has(agentId) || this.systemAgentIds.has(agentId)) {
        throw new AgentRegistryMutationError(
          "AGENT_ALREADY_EXISTS",
          `Agent ${agentId} already exists`,
          409,
          { agentId }
        )
      }

      const allowedTools = this.normalizeAllowedTools(input.allowedTools)
      const agent: AgentDefinition = {
        id: agentId,
        name: input.name,
        description: input.description,
        tier: "primary",
        origin: "user",
        visibility: "visible",
        entryPolicy: "callable",
        delegationPolicy: "can-delegate",
        executorType: "ai-sdk",
        systemPrompt: input.systemPrompt,
        capabilities: this.normalizeStringList(input.capabilities),
        allowedSubagents: this.normalizeAllowedSubagents(input.allowedSubagents),
        allowedTools,
        allowedSkills: this.normalizeAllowedSkills(input.allowedSkills),
        permissionPolicy: this.normalizeUserPermissionPolicy(input.permissionPolicy, allowedTools),
        toolPermissionRules: this.normalizeUserToolPermissionRules(input.toolPermissionRules),
        enabled: input.enabled,
        readonly: false,
        createdAt: now,
        updatedAt: now,
      }

      const snapshot = this.createStateSnapshot()
      try {
        this.normalizeAllowedTools(agent.allowedTools)
        this.normalizeUserPermissionPolicy(agent.permissionPolicy, agent.allowedTools)
        this.baseAgents.set(agent.id, this.cloneAgent(agent))
        this.agents.set(agent.id, this.applyModelBinding(agent))
      } catch (error) {
        console.warn(`Ignoring invalid user agent "${agent.id}"`, error)
      }

      await this.persistAgentsOrRollback(snapshot)
      return this.cloneAgent(this.agents.get(agent.id) ?? agent)
    })
  }

  async updateUserAgent(agentId: string, input: UserAgentUpdateRequest): Promise<AgentDefinition | null> {
    return this.serializeMutation(async () => {
      const current = this.agents.get(agentId)
      if (!current) {
        return null
      }

      this.assertEditableUserAgent(current)

      const baseAgent = this.cloneAgent(this.baseAgents.get(agentId) ?? current)
      const allowedTools = input.allowedTools
        ? this.normalizeAllowedTools(input.allowedTools)
        : baseAgent.allowedTools
      const updated: AgentDefinition = {
        ...baseAgent,
        name: input.name ?? baseAgent.name,
        description: input.description ?? baseAgent.description,
        systemPrompt: input.systemPrompt ?? baseAgent.systemPrompt,
        capabilities: input.capabilities
          ? this.normalizeStringList(input.capabilities)
          : baseAgent.capabilities,
        allowedSubagents: input.allowedSubagents
          ? this.normalizeAllowedSubagents(input.allowedSubagents)
          : baseAgent.allowedSubagents,
        allowedTools,
        allowedSkills: input.allowedSkills
          ? this.normalizeAllowedSkills(input.allowedSkills)
          : baseAgent.allowedSkills,
        permissionPolicy: input.permissionPolicy || input.allowedTools
          ? this.normalizeUserPermissionPolicy(input.permissionPolicy, allowedTools)
          : baseAgent.permissionPolicy,
        toolPermissionRules: input.toolPermissionRules !== undefined
          ? this.normalizeUserToolPermissionRules(input.toolPermissionRules)
          : baseAgent.toolPermissionRules,
        enabled: input.enabled ?? baseAgent.enabled,
        updatedAt: new Date().toISOString(),
      }

      const snapshot = this.createStateSnapshot()
      this.baseAgents.set(agentId, this.cloneAgent(updated))
      this.agents.set(agentId, this.applyModelBinding(updated))

      await this.persistAgentsOrRollback(snapshot)
      return this.cloneAgent(this.agents.get(agentId) ?? updated)
    })
  }

  async deleteUserAgent(agentId: string): Promise<boolean> {
    return this.serializeMutation(async () => {
      const current = this.agents.get(agentId)
      if (!current) {
        return false
      }

      this.assertEditableUserAgent(current)

      const snapshot = this.createStateSnapshot()
      this.baseAgents.delete(agentId)
      this.agents.delete(agentId)
      delete this.modelBindings[agentId]

      await this.persistAgentsOrRollback(snapshot, true)
      return true
    })
  }

  isModelBindingAllowed(agentId: string): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) {
      return false
    }

    return this.canBindModel(agent)
  }

  async setAgentModelBinding(agentId: string, modelRef: AgentModelRef): Promise<AgentDefinition | null> {
    return this.serializeMutation(async () => {
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
    })
  }

  async clearAgentModelBinding(agentId: string): Promise<AgentDefinition | null> {
    return this.serializeMutation(async () => {
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
    })
  }

  listCallablePrimaryAgents(): AgentDefinition[] {
    return this.listAgents({ includeHidden: false, enabledOnly: true, tier: "primary" })
      .filter((agent) => agent.entryPolicy === "callable" || agent.entryPolicy === "default")
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
      this.agents.set(agent.id, this.applyModelBinding(clonedAgent))
      this.systemAgentIds.add(agent.id)
    }

  }

  private validateDefaultEntryAgent(): void {
    this.getDefaultEntryAgent()
  }

  private assertEditableUserAgent(agent: AgentDefinition): void {
    if (
      agent.origin !== "user" ||
      agent.readonly ||
      agent.tier !== "primary" ||
      agent.visibility !== "visible" ||
      agent.executorType !== "ai-sdk"
    ) {
      throw new AgentRegistryMutationError(
        "AGENT_NOT_EDITABLE",
        `Agent ${agent.id} is not editable`,
        403,
        {
          agentId: agent.id,
          origin: agent.origin,
          tier: agent.tier,
          readonly: agent.readonly,
          executorType: agent.executorType,
        }
      )
    }
  }

  private normalizeAllowedSubagents(subagentIds: string[]): string[] {
    const normalized = this.normalizeStringList(subagentIds)

    for (const subagentId of normalized) {
      const subagent = this.agents.get(subagentId)
      if (
        !subagent ||
        !subagent.enabled ||
        subagent.tier !== "subagent" ||
        subagent.visibility !== "hidden" ||
        subagent.entryPolicy !== "not-callable" ||
        subagent.delegationPolicy !== "delegated-only"
      ) {
        throw new AgentRegistryMutationError(
          "AGENT_INVALID_INPUT",
          `Invalid allowed subagent ${subagentId}`,
          400,
          {
            field: "allowedSubagents",
            subagentId,
          }
        )
      }
    }

    return normalized
  }

  private normalizeAllowedTools(toolNames: string[]): string[] {
    const implicitToolSet = new Set<string>(IMPLICIT_AI_SDK_TOOLS)
    const normalized = this.normalizeStringList(toolNames)
      .filter((toolName) => !implicitToolSet.has(toolName))
    const configurableTools = this.toolCatalog.listUserConfigurableTools()
    const allowedToolSet = new Set(configurableTools.map((tool) => tool.id))

    for (const toolName of normalized) {
      if (!allowedToolSet.has(toolName)) {
        throw new AgentRegistryMutationError(
          "AGENT_INVALID_INPUT",
          `Tool ${toolName} is not available for user agents`,
          400,
          {
            field: "allowedTools",
            toolName,
            allowedTools: Array.from(allowedToolSet),
          }
        )
      }
    }

    return normalized
  }

  private normalizeAllowedSkills(skillRefs: string[] | undefined): string[] {
    return this.normalizeStringList(skillRefs ?? [])
  }

  private normalizeUserPermissionPolicy(
    policy: AgentPermissionPolicy | undefined,
    allowedTools: string[]
  ): AgentPermissionPolicy {
    const normalized = this.clonePermissionPolicy(policy ?? DEFAULT_USER_AGENT_PERMISSION_POLICY)
    const violations: Array<{ path: string[]; message: string }> = []
    const configurableTools = this.toolCatalog.listUserConfigurableTools()
    const selectedTools = configurableTools.filter((tool) => allowedTools.includes(tool.id))

    const requiredFilesystem = selectedTools
      .map((tool) => tool.requiredPermissions.filesystem)
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .sort((left, right) => FILESYSTEM_PERMISSION_RANK[right] - FILESYSTEM_PERMISSION_RANK[left])[0]

    if (
      requiredFilesystem &&
      FILESYSTEM_PERMISSION_RANK[normalized.filesystem] < FILESYSTEM_PERMISSION_RANK[requiredFilesystem]
    ) {
      violations.push({
        path: ["permissionPolicy", "filesystem"],
        message: `Selected tools require filesystem ${requiredFilesystem} permission`,
      })
    }

    if (normalized.shell !== "none") {
      violations.push({
        path: ["permissionPolicy", "shell"],
        message: "User agents cannot request shell permission in this CRUD version",
      })
    }

    if (normalized.network !== "none") {
      violations.push({
        path: ["permissionPolicy", "network"],
        message: "User agents cannot request network tool permission in this CRUD version",
      })
    }

    if (normalized.deploy !== "none") {
      violations.push({
        path: ["permissionPolicy", "deploy"],
        message: "User agents cannot request deploy permission in this CRUD version",
      })
    }

    if (violations.length > 0) {
      throw new AgentRegistryMutationError(
        "AGENT_INVALID_INPUT",
        "Invalid user agent permission policy",
        400,
        violations
      )
    }

    return normalized
  }

  private normalizeUserToolPermissionRules(
    rules: AgentToolPermissionRules | undefined
  ): AgentToolPermissionRules | undefined {
    if (!rules) {
      return undefined
    }

    const normalized = this.cloneToolPermissionRules(rules)
    if (normalized.bash && Object.keys(normalized.bash).length > 0) {
      throw new AgentRegistryMutationError(
        "AGENT_INVALID_INPUT",
        "Invalid user agent tool permission rules",
        400,
        [{
          path: ["toolPermissionRules", "bash"],
          message: "User agents cannot configure bash permission rules in this CRUD version",
        }]
      )
    }
    if (normalized.bash && Object.keys(normalized.bash).length === 0) {
      delete normalized.bash
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined
  }

  private normalizeStringList(values: string[]): string[] {
    const seen = new Set<string>()
    const normalized: string[] = []

    for (const value of values) {
      const trimmed = value.trim()
      if (!trimmed || seen.has(trimmed)) {
        continue
      }

      seen.add(trimmed)
      normalized.push(trimmed)
    }

    return normalized
  }

  private normalizeLoadedUserAgent(agent: AgentDefinition): AgentDefinition | null {
    const normalized = this.cloneAgent(agent)
    if (normalized.tier === "subagent" && normalized.modelRef) {
      console.warn(`Ignoring modelRef on subagent "${normalized.id}" because subagents inherit the caller model`)
      delete normalized.modelRef
    }

    if (normalized.origin !== "user") {
      return normalized
    }

    try {
      normalized.allowedTools = this.normalizeAllowedTools(normalized.allowedTools)
      normalized.allowedSubagents = this.normalizeAllowedSubagents(normalized.allowedSubagents)
      normalized.allowedSkills = this.normalizeAllowedSkills(normalized.allowedSkills)
      normalized.permissionPolicy = this.normalizeUserPermissionPolicy(
        normalized.permissionPolicy,
        normalized.allowedTools
      )
      normalized.toolPermissionRules = this.normalizeUserToolPermissionRules(normalized.toolPermissionRules)
      return normalized
    } catch (error) {
      console.warn(`Ignoring invalid user agent "${normalized.id}"`, error)
      return null
    }
  }

  private async persistAgentsOrRollback(
    snapshot: AgentRegistryStateSnapshot,
    persistBindings = false
  ): Promise<void> {
    try {
      await this.store.saveAgents(this.listPersistableAgents())
      if (persistBindings) {
        await this.bindingStore.saveBindings(this.modelBindings)
      }
    } catch (error) {
      this.restoreStateSnapshot(snapshot)
      throw new AgentRegistryMutationError(
        "AGENT_STORE_WRITE_FAILED",
        "Failed to persist user agents",
        500,
        {
          message: error instanceof Error ? error.message : String(error),
        }
      )
    }
  }

  private listPersistableAgents(): AgentDefinition[] {
    return Array.from(this.baseAgents.values())
      .filter((agent) => !this.systemAgentIds.has(agent.id))
      .map((agent) => this.cloneAgent(agent))
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  private serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(operation, operation)
    this.writeQueue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  private createStateSnapshot(): AgentRegistryStateSnapshot {
    return {
      baseAgents: new Map(this.baseAgents),
      agents: new Map(this.agents),
      modelBindings: structuredClone(this.modelBindings),
    }
  }

  private restoreStateSnapshot(snapshot: AgentRegistryStateSnapshot): void {
    this.baseAgents = snapshot.baseAgents
    this.agents = snapshot.agents
    this.modelBindings = snapshot.modelBindings
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
    const cloned = this.applyImplicitRuntimeTools(this.cloneAgent(agent))
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

  private applyImplicitRuntimeTools(agent: AgentDefinition): AgentDefinition {
    if (
      agent.origin === "external" ||
      (agent.executorType !== "ai-sdk" && agent.executorType !== "orchestrator")
    ) {
      return agent
    }

    const allowedTools = new Set(agent.allowedTools)
    for (const toolName of IMPLICIT_AI_SDK_TOOLS) {
      allowedTools.add(toolName)
    }
    agent.allowedTools = Array.from(allowedTools)
    return agent
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

  private clonePermissionPolicy(policy: AgentPermissionPolicy): AgentPermissionPolicy {
    return {
      filesystem: policy.filesystem,
      shell: policy.shell,
      network: policy.network,
      deploy: policy.deploy,
    }
  }

  private cloneToolPermissionRules(rules: AgentToolPermissionRules): AgentToolPermissionRules {
    return structuredClone(rules)
  }
}

type AgentRegistryStateSnapshot = {
  baseAgents: Map<string, AgentDefinition>
  agents: Map<string, AgentDefinition>
  modelBindings: AgentModelBindingMap
}

