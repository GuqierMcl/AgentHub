import { z } from "zod"
import type { ProviderProtocol } from "../provider"

export const AgentTierSchema = z.enum(["primary", "subagent"])
export type AgentTier = z.infer<typeof AgentTierSchema>

export const AgentOriginSchema = z.enum(["system", "user", "external"])
export type AgentOrigin = z.infer<typeof AgentOriginSchema>

export const AgentVisibilitySchema = z.enum(["visible", "hidden"])
export type AgentVisibility = z.infer<typeof AgentVisibilitySchema>

export type AgentModelRef = {
  providerId: string
  modelId: string
}

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
  requiresApproval: z.boolean(),
})
export type AgentPermissionPolicy = z.infer<typeof AgentPermissionPolicySchema>

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
  modelRef: z.object({
    providerId: z.string().min(1),
    modelId: z.string().min(1),
  }).optional(),
  capabilities: z.array(z.string()).default([]),
  allowedSubagents: z.array(z.string()).default([]),
  allowedTools: z.array(z.string()).default([]),
  permissionPolicy: AgentPermissionPolicySchema,
  external: ExternalAgentConfigSchema.optional(),
  enabled: z.boolean().default(true),
  readonly: z.boolean().default(false),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>

export const AgentRelationSchema = z.object({
  id: z.string().min(1),
  fromAgentId: z.string().min(1),
  toAgentId: z.string().min(1),
  relationType: z.literal("can_delegate_to"),
  taskTypes: z.array(z.string()).optional(),
  priority: z.number().int().default(0),
  enabled: z.boolean().default(true),
})
export type AgentRelation = z.infer<typeof AgentRelationSchema>

export const AgentDefinitionListSchema = z.array(AgentDefinitionSchema)
export const AgentRelationListSchema = z.array(AgentRelationSchema)

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

export type AgentRelationListOptions = {
  enabledOnly?: boolean
  fromAgentId?: string
  toAgentId?: string
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
  allowedSubagents: string[]
  allowedTools: string[]
  permissionPolicy: AgentPermissionPolicy
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

