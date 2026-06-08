import { z } from "zod"
import type { ProviderProtocol } from "../provider"

export const AgentTierSchema = z.enum(["primary", "subagent"])
export type AgentTier = z.infer<typeof AgentTierSchema>

export const AgentOriginSchema = z.enum(["system", "user", "external"])
export type AgentOrigin = z.infer<typeof AgentOriginSchema>

export const AgentVisibilitySchema = z.enum(["visible", "hidden"])
export type AgentVisibility = z.infer<typeof AgentVisibilitySchema>

export const AgentModelRefSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
})
export type AgentModelRef = z.infer<typeof AgentModelRefSchema>

export const AgentModelBindingMapSchema = z.record(z.string(), AgentModelRefSchema)
export type AgentModelBindingMap = z.infer<typeof AgentModelBindingMapSchema>

export const AgentModelBindingUpdateRequestSchema = AgentModelRefSchema
export type AgentModelBindingUpdateRequest = z.infer<typeof AgentModelBindingUpdateRequestSchema>

const ExternalAgentModelNameSchema = z.string().trim().min(1).max(200)

export const ExternalAgentIdSchema = z.enum(["opencode", "claude-code", "codex"])
export type ExternalAgentId = z.infer<typeof ExternalAgentIdSchema>

export const OpenCodeExternalAgentSettingsSchema = z.object({
  provider: z.literal("opencode"),
  model: z.object({
    providerID: z.string().trim().min(1),
    modelID: z.string().trim().min(1),
  }).strip().optional(),
  executionAgent: z.enum(["build", "plan"]).optional(),
  updatedAt: z.string().optional(),
}).strip()

export const ClaudeCodeExternalAgentSettingsSchema = z.object({
  provider: z.literal("claude-code"),
  model: ExternalAgentModelNameSchema.optional(),
  permissionMode: z.enum(["default", "acceptEdits", "plan", "dontAsk", "auto"]).optional(),
  updatedAt: z.string().optional(),
}).strip()

export const CodexExternalAgentSettingsSchema = z.object({
  provider: z.literal("codex"),
  model: ExternalAgentModelNameSchema.optional(),
  updatedAt: z.string().optional(),
}).strip()

export const ExternalAgentSettingsSchema = z.discriminatedUnion("provider", [
  OpenCodeExternalAgentSettingsSchema,
  ClaudeCodeExternalAgentSettingsSchema,
  CodexExternalAgentSettingsSchema,
])
export type ExternalAgentSettings = z.infer<typeof ExternalAgentSettingsSchema>

export const ExternalAgentSettingsMapSchema = z.object({
  opencode: OpenCodeExternalAgentSettingsSchema.optional(),
  "claude-code": ClaudeCodeExternalAgentSettingsSchema.optional(),
  codex: CodexExternalAgentSettingsSchema.optional(),
}).strip()
export type ExternalAgentSettingsMap = z.infer<typeof ExternalAgentSettingsMapSchema>

export const ExternalAgentSettingsUpdateRequestSchema = ExternalAgentSettingsSchema
export type ExternalAgentSettingsUpdateRequest = z.infer<typeof ExternalAgentSettingsUpdateRequestSchema>

export const AgentIdSchema = z.string()
  .min(3)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/, "Agent id must start with a lowercase letter and contain only lowercase letters, numbers, underscores, or hyphens")

export const AgentSkillRefSchema = z.string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^(global|workspace):(agents|codex|claude-code|opencode):[A-Za-z0-9._:-]+$/, "Skill refs must be logical capability refs")
export type AgentSkillRef = z.infer<typeof AgentSkillRefSchema>

export const AgentEntryPolicySchema = z.enum(["default", "callable", "not-callable"])
export type AgentEntryPolicy = z.infer<typeof AgentEntryPolicySchema>

export const AgentDelegationPolicySchema = z.enum([
  "can-delegate",
  "delegated-only",
  "terminal",
])
export type AgentDelegationPolicy = z.infer<typeof AgentDelegationPolicySchema>

export const AgentExecutorTypeSchema = z.enum([
  "orchestrator",
  "ai-sdk",
  "mock",
  "external-adapter",
])
export type AgentExecutorType = z.infer<typeof AgentExecutorTypeSchema>

export const AgentPermissionPolicySchema = z.object({
  filesystem: z.enum(["none", "read", "write"]),
  shell: z.enum(["none", "limited", "full"]),
  network: z.enum(["none", "limited", "full"]),
  deploy: z.enum(["none", "preview", "publish"]),
}).strip()
export type AgentPermissionPolicy = z.infer<typeof AgentPermissionPolicySchema>

export const BashPermissionActionSchema = z.enum(["allow", "ask", "deny"])
export type BashPermissionAction = z.infer<typeof BashPermissionActionSchema>

export const BashPermissionRulesSchema = z.record(
  z.string().min(1).max(256),
  BashPermissionActionSchema
)
export type BashPermissionRules = z.infer<typeof BashPermissionRulesSchema>

export const AgentToolPermissionRulesSchema = z.object({
  bash: BashPermissionRulesSchema.optional(),
}).strip()
export type AgentToolPermissionRules = z.infer<typeof AgentToolPermissionRulesSchema>

export const DEFAULT_USER_AGENT_PERMISSION_POLICY: AgentPermissionPolicy = {
  filesystem: "none",
  shell: "none",
  network: "none",
  deploy: "none",
}

export const ExternalAgentConfigSchema = z.object({
  provider: z.enum(["opencode", "claude-code", "codex"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  workingDirectoryPolicy: z.enum(["runtime-workspace", "user-workspace"]),
  configDirectoryPolicy: z.enum(["runtime-managed", "user-global"]),
  outputFormat: z.enum(["text", "json", "event-stream"]),
})
export type ExternalAgentConfig = z.infer<typeof ExternalAgentConfigSchema>

export const AgentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  tier: AgentTierSchema,
  origin: AgentOriginSchema,
  visibility: AgentVisibilitySchema,
  entryPolicy: AgentEntryPolicySchema,
  delegationPolicy: AgentDelegationPolicySchema,
  executorType: AgentExecutorTypeSchema,
  systemPrompt: z.string().optional(),
  modelRef: AgentModelRefSchema.optional(),
  capabilities: z.array(z.string()).default([]),
  allowedSubagents: z.array(z.string()).default([]),
  allowedTools: z.array(z.string()).default([]),
  allowedSkills: z.array(AgentSkillRefSchema).default([]),
  permissionPolicy: AgentPermissionPolicySchema,
  toolPermissionRules: AgentToolPermissionRulesSchema.optional(),
  external: ExternalAgentConfigSchema.optional(),
  enabled: z.boolean().default(true),
  readonly: z.boolean().default(false),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>

export const AgentDefinitionListSchema = z.array(AgentDefinitionSchema)

export const UserAgentCreateRequestSchema = z.object({
  id: AgentIdSchema.optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000),
  systemPrompt: z.string().trim().min(1).max(20000),
  capabilities: z.array(z.string().trim().min(1).max(80)).default([]),
  allowedSubagents: z.array(z.string().trim().min(1)).default([]),
  allowedTools: z.array(z.string().trim().min(1)).default([]),
  allowedSkills: z.array(AgentSkillRefSchema).max(20).default([]),
  permissionPolicy: AgentPermissionPolicySchema.optional(),
  toolPermissionRules: AgentToolPermissionRulesSchema.optional(),
  enabled: z.boolean().default(true),
}).strict()
export type UserAgentCreateRequest = z.infer<typeof UserAgentCreateRequestSchema>

export const UserAgentUpdateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().min(1).max(1000).optional(),
  systemPrompt: z.string().trim().min(1).max(20000).optional(),
  capabilities: z.array(z.string().trim().min(1).max(80)).optional(),
  allowedSubagents: z.array(z.string().trim().min(1)).optional(),
  allowedTools: z.array(z.string().trim().min(1)).optional(),
  allowedSkills: z.array(AgentSkillRefSchema).max(20).optional(),
  permissionPolicy: AgentPermissionPolicySchema.optional(),
  toolPermissionRules: AgentToolPermissionRulesSchema.optional(),
  enabled: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field must be provided",
})
export type UserAgentUpdateRequest = z.infer<typeof UserAgentUpdateRequestSchema>

export const AgentListQuerySchema = z.object({
  includeHidden: z.enum(["true", "false"]).optional(),
  enabledOnly: z.enum(["true", "false"]).optional(),
  tier: AgentTierSchema.optional(),
  origin: AgentOriginSchema.optional(),
})
export type AgentListQuery = z.infer<typeof AgentListQuerySchema>

export const AgentDetailQuerySchema = z.object({
  includeHidden: z.enum(["true", "false"]).optional(),
})
export type AgentDetailQuery = z.infer<typeof AgentDetailQuerySchema>

export type AgentListOptions = {
  includeHidden?: boolean
  enabledOnly?: boolean
  tier?: AgentTier
  origin?: AgentOrigin
}

export type AgentSummaryResponse = {
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
  resolvedModel?: AgentResolvedModelResponse
}

export type AgentDetailResponse = AgentSummaryResponse & {
  systemPrompt?: string
  allowedSubagents: string[]
  allowedTools: string[]
  allowedSkills: string[]
  permissionPolicy: AgentPermissionPolicy
  toolPermissionRules?: AgentToolPermissionRules
  modelRef?: AgentModelRef
  resolvedModel?: AgentResolvedModelResponse
  external?: {
    provider: ExternalAgentConfig["provider"]
    outputFormat: ExternalAgentConfig["outputFormat"]
    workingDirectoryPolicy: ExternalAgentConfig["workingDirectoryPolicy"]
    configDirectoryPolicy: ExternalAgentConfig["configDirectoryPolicy"]
  }
}

export type AgentResolvedModelResponse = {
  providerId: string
  modelId: string
  modelSourceAgentId?: string
  modelSourceType?: "agent-binding" | "system-default"
  fallbackFromModelRef?: AgentModelRef
  providerProtocol: ProviderProtocol
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

export type AgentListResponse = {
  agents: AgentSummaryResponse[]
}

export type AgentDeleteResponse = {
  agentId: string
  deleted: true
}

export type AgentAuthoringToolOption = {
  id: string
  name: string
  description: string
  category: string
  riskLevel: "low" | "medium" | "high"
  approvalPolicy: "never" | "contextual" | "always"
  requiredPermissions: Partial<Pick<AgentPermissionPolicy, "filesystem" | "shell" | "network" | "deploy">>
}

export type AgentAuthoringCapabilityTagOption = string

export type AgentAuthoringSubagentOption = {
  id: string
  name: string
  description: string
  capabilities: string[]
}

export type AgentAuthoringOptionsResponse = {
  tools: AgentAuthoringToolOption[]
  capabilityTags: AgentAuthoringCapabilityTagOption[]
  subagents: AgentAuthoringSubagentOption[]
  defaults: {
    allowedTools: string[]
    allowedSubagents: string[]
    permissionPolicy: AgentPermissionPolicy
  }
}

export type AgentToolAuthoringCatalog = {
  listUserConfigurableTools(): AgentAuthoringToolOption[]
}

