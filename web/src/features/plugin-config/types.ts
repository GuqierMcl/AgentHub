export type CapabilitySource = "agents" | "codex" | "claude-code" | "opencode"

export type CapabilityLevel = "global" | "workspace"

export type CapabilityScope = "all" | "global" | "workspace"

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
  scope: CapabilityScope
  skills: SkillItem[]
  mcps: McpItem[]
  warnings: string[]
  cache?: CapabilitiesCache
}
