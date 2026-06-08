export type CapabilitySource = "agents" | "codex" | "claude-code" | "opencode"

export type CapabilityLevel = "global" | "workspace"

export type CapabilityScope = "global" | "workspace"

export type McpTransport = "stdio" | "sse" | "http" | "unknown"

export type SkillItem = {
  id: string
  name: string
  source: CapabilitySource
  level: CapabilityLevel
  path: string
  description?: string
  valid: boolean
  warnings: string[]
}

export type McpItem = {
  id: string
  name: string
  source: CapabilitySource
  level: CapabilityLevel
  configPath: string
  transport?: McpTransport
  command?: string
  args?: string[]
  valid: boolean
  warnings: string[]
}

export type CapabilitiesCache = {
  hit: boolean
  refreshed: boolean
  cacheKey: string
  expiresAt: string
  fingerprint: string
}

export type CapabilitiesResponse = {
  discoveredAt: string
  scope: "global"
  skills: SkillItem[]
  mcps: McpItem[]
  warnings: string[]
  cache?: CapabilitiesCache
}

export type WorkspaceSkillTrustRecord = {
  workspaceId: string
  backendType: "local"
  workspaceRootHash: string
  skillRef: string
  source: CapabilitySource
  trusted: boolean
  status: "trusted" | "untrusted"
  trustedAt?: string
  revokedAt?: string
  createdAt: string
  updatedAt: string
}

export type WorkspaceSkillTrustQueryResponse = {
  checkedAt: string
  workspace: {
    workspaceId: string
    backendType: "local"
    workspaceRootHash: string
  }
  trusts: WorkspaceSkillTrustRecord[]
}

export type WorkspaceSkillTrustDecisionResponse = {
  record: WorkspaceSkillTrustRecord
}

export type WorkspaceCapabilityGroup = {
  workspaceKey: string
  workspaceId: string
  backendType: "local"
  rootPath: string
  conversationId: string
  conversationIds: string[]
  title: string
  discoveredAt: string
  skills: SkillItem[]
  mcps: McpItem[]
  warnings: string[]
  cache?: CapabilitiesCache
}

export type WorkspaceCapabilitiesResponse = {
  discoveredAt: string
  scope: "workspace"
  workspaces: WorkspaceCapabilityGroup[]
  warnings: string[]
}
