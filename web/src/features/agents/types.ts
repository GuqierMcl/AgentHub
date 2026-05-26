export type AgentTier = "primary" | "subagent"
export type AgentOrigin = "system" | "user" | "external"
export type AgentVisibility = "visible" | "hidden"
export type AgentEntryPolicy = "default" | "callable" | "not-callable"
export type AgentDelegationPolicy = "can-delegate" | "delegated-only" | "terminal"
export type AgentExecutorType = "orchestrator" | "ai-sdk" | "mock" | "external-adapter"

export type AgentModelRef = {
  providerId: string
  modelId: string
}

export type AgentPermissionPolicy = {
  filesystem: "none" | "read" | "write"
  shell: "none" | "limited" | "full"
  network: "none" | "limited" | "full"
  deploy: "none" | "preview" | "publish"
}

export type UserAgentAllowedTool = "ls" | "read_file" | "glob" | "grep" | "write_file" | "edit_file"

export type AuthoringToolOption = {
  id: string
  name: string
  description: string
  category: string
  riskLevel: "low" | "medium" | "high"
  approvalPolicy: "contextual" | "always" | "never"
  requiredPermissions: Record<string, string>
}

export type AuthoringCapabilityTag = {
  id: string
  name: string
  category: string
}

export type AuthoringSubagentOption = {
  id: string
  name: string
  description: string
  capabilities: string[]
}

export type AuthoringDefaults = {
  allowedTools: string[]
  allowedSubagents: string[]
  permissionPolicy: AgentPermissionPolicy
}

export type AuthoringOptionsResponse = {
  tools: AuthoringToolOption[]
  capabilityTags: AuthoringCapabilityTag[]
  subagents: AuthoringSubagentOption[]
  defaults: AuthoringDefaults
}

export type AgentResolvedModel = {
  providerId: string
  modelId: string
  providerProtocol: string
  providerName: string
  modelName: string
  upstreamModelId: string
  contextLength: number
  outputLength: number
  capabilities: {
    supports_tools: boolean
    supports_vision: boolean
    supports_reasoning: boolean
    temperature: boolean
  }
  enabled: boolean
}

export type AgentSummary = {
  id: string
  name: string
  description: string
  tier: AgentTier
  origin: AgentOrigin
  visibility: AgentVisibility
  entryPolicy: AgentEntryPolicy
  delegationPolicy: AgentDelegationPolicy
  executorType: AgentExecutorType
  capabilities: string[]
  enabled: boolean
  readonly: boolean
  modelRef?: AgentModelRef
  resolvedModel?: AgentResolvedModel
}

export type AgentDetail = AgentSummary & {
  systemPrompt?: string
  allowedSubagents: string[]
  allowedTools: string[]
  permissionPolicy: AgentPermissionPolicy
  external?: {
    provider: string
    outputFormat: string
    workingDirectoryPolicy: string
    configDirectoryPolicy: string
  }
}

export type AgentListResponse = {
  agents: AgentSummary[]
}

export type AgentDeleteResponse = {
  agentId: string
  deleted: true
}

export type UserAgentCreateRequest = {
  id?: string
  name: string
  description: string
  systemPrompt: string
  capabilities?: string[]
  allowedSubagents?: string[]
  allowedTools?: UserAgentAllowedTool[]
  permissionPolicy?: AgentPermissionPolicy
  enabled?: boolean
}

export type UserAgentUpdateRequest = {
  name?: string
  description?: string
  systemPrompt?: string
  capabilities?: string[]
  allowedSubagents?: string[]
  allowedTools?: UserAgentAllowedTool[]
  permissionPolicy?: AgentPermissionPolicy
  enabled?: boolean
}
