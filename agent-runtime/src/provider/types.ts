import { z } from "zod"

// ── 协议类型 ──

export const ProviderProtocolSchema = z.enum(["openai", "anthropic", "openai_compatible"])
export type ProviderProtocol = z.infer<typeof ProviderProtocolSchema>

// ── 模型能力 ──

export const ModelCapabilitiesSchema = z.object({
  supports_tools: z.boolean().default(false),
  supports_vision: z.boolean().default(false),
  supports_reasoning: z.boolean().default(false),
  temperature: z.boolean().default(false),
})
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>

// ── 模型成本 ──

export const ModelCostSchema = z.object({
  input: z.number().default(0),   // per 1M tokens
  output: z.number().default(0),
})
export type ModelCost = z.infer<typeof ModelCostSchema>

// ── Provider 下的模型 ──

export const ProviderModelSchema = z.object({
  id: z.string(),
  provider_id: z.string(),
  upstream_id: z.string(),
  name: z.string(),
  context_length: z.number().default(128000),
  output_length: z.number().default(4096),
  capabilities: ModelCapabilitiesSchema,
  cost: ModelCostSchema,
  source: z.enum(["preset", "custom"]).default("preset"),
  enabled: z.boolean().default(true),
})
export type ProviderModel = z.infer<typeof ProviderModelSchema>

// ── Provider 信息 ──

export const ProviderInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  api_base: z.string().default(""),
  api_key: z.string().nullable().default(null),
  enabled: z.boolean().default(false),
  source: z.enum(["preset", "custom"]).default("preset"),
  api_protocol: ProviderProtocolSchema.default("openai_compatible"),
  models: z.record(z.string(), ProviderModelSchema).default({}),
})
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>

// ── API 响应类型 ──

export const ModelCapabilitiesResponseSchema = z.object({
  supports_tools: z.boolean(),
  supports_vision: z.boolean(),
  supports_reasoning: z.boolean(),
  temperature: z.boolean(),
})

export const ModelCostResponseSchema = z.object({
  input: z.number(),
  output: z.number(),
})

export const ModelResponseSchema = z.object({
  id: z.string(),
  upstream_id: z.string(),
  name: z.string(),
  context_length: z.number(),
  output_length: z.number(),
  capabilities: ModelCapabilitiesResponseSchema,
  cost: ModelCostResponseSchema,
  source: z.string(),
  enabled: z.boolean(),
})
export type ModelResponse = z.infer<typeof ModelResponseSchema>

export const ProviderSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  api_base: z.string(),
  enabled: z.boolean(),
  source: z.string(),
  has_api_key: z.boolean(),
  model_count: z.number(),
  api_protocol: ProviderProtocolSchema,
})
export type ProviderSummary = z.infer<typeof ProviderSummarySchema>

export const ProviderDetailSchema = ProviderSummarySchema.extend({
  api_key: z.string().nullable(),
  models: z.record(z.string(), ModelResponseSchema),
})
export type ProviderDetail = z.infer<typeof ProviderDetailSchema>

export const ProviderListResponseSchema = z.object({
  providers: z.array(ProviderSummarySchema),
})
export type ProviderListResponse = z.infer<typeof ProviderListResponseSchema>

// ── API 请求类型 ──

export const ProviderConfigUpdateRequestSchema = z.object({
  api_key: z.string().optional(),
  enabled: z.boolean().optional(),
  api_base: z.string().optional(),
})
export type ProviderConfigUpdateRequest = z.infer<typeof ProviderConfigUpdateRequestSchema>

export const ProviderConfigUpdateResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  api_base: z.string(),
  enabled: z.boolean(),
  has_api_key: z.boolean(),
  api_protocol: ProviderProtocolSchema,
})
export type ProviderConfigUpdateResponse = z.infer<typeof ProviderConfigUpdateResponseSchema>

export const ModelConfigUpdateRequestSchema = z.object({
  enabled: z.boolean(),
})
export type ModelConfigUpdateRequest = z.infer<typeof ModelConfigUpdateRequestSchema>

export const CustomProviderCreateRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  api_base: z.string().url(),
  api_key: z.string().optional(),
  models: z.record(z.string(), z.object({
    name: z.string().optional(),
    upstream_id: z.string().optional(),
    context_length: z.number().optional(),
    supports_tools: z.boolean().optional(),
    supports_vision: z.boolean().optional(),
  })).optional(),
})
export type CustomProviderCreateRequest = z.infer<typeof CustomProviderCreateRequestSchema>

export const CustomProviderUpdateRequestSchema = z.object({
  name: z.string().optional(),
  api_base: z.string().url().optional(),
  api_key: z.string().optional(),
  models: z.record(z.string(), z.object({
    name: z.string().optional(),
    upstream_id: z.string().optional(),
    context_length: z.number().optional(),
    supports_tools: z.boolean().optional(),
    supports_vision: z.boolean().optional(),
  })).optional(),
})
export type CustomProviderUpdateRequest = z.infer<typeof CustomProviderUpdateRequestSchema>

export const DeleteResponseSchema = z.object({
  deleted: z.boolean(),
})
export type DeleteResponse = z.infer<typeof DeleteResponseSchema>

export const CatalogRefreshResponseSchema = z.object({
  status: z.string(),
  provider_count: z.number(),
})
export type CatalogRefreshResponse = z.infer<typeof CatalogRefreshResponseSchema>

// ── models.dev API 响应类型 ──

export const ModelsDevModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  attachment: z.boolean().optional().default(false),
  reasoning: z.boolean().optional().default(false),
  tool_call: z.boolean().optional().default(false),
  temperature: z.boolean().optional().default(true),
  release_date: z.string().optional(),
  modalities: z.object({
    input: z.array(z.string()).optional().default(["text"]),
    output: z.array(z.string()).optional().default(["text"]),
  }).optional().default({ input: ["text"], output: ["text"] }),
  limit: z.object({
    context: z.number().optional().default(128000),
    output: z.number().optional().default(4096),
  }).optional().default({ context: 128000, output: 4096 }),
  cost: z.object({
    input: z.number().optional().default(0),
    output: z.number().optional().default(0),
  }).optional().default({ input: 0, output: 0 }),
  npm: z.string().optional(),
  status: z.string().optional(),
})
export type ModelsDevModel = z.infer<typeof ModelsDevModelSchema>

export const ModelsDevProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  npm: z.string().optional(),
  api: z.string().optional(),
  env: z.array(z.string()).optional().default([]),
  doc: z.string().optional(),
  models: z.record(z.string(), ModelsDevModelSchema).optional().default({}),
})
export type ModelsDevProvider = z.infer<typeof ModelsDevProviderSchema>

export const ModelsDevCatalogSchema = z.record(z.string(), ModelsDevProviderSchema)
export type ModelsDevCatalog = z.infer<typeof ModelsDevCatalogSchema>

// ── 用户配置类型 ──

export const UserProviderConfigSchema = z.object({
  api_key: z.string().optional(),
  enabled: z.boolean().optional(),
  api_base: z.string().optional(),
  name: z.string().optional(),
  models: z.record(z.string(), z.object({
    name: z.string().optional(),
    upstream_id: z.string().optional(),
    context_length: z.number().optional(),
    supports_tools: z.boolean().optional(),
    supports_vision: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })).optional(),
})
export type UserProviderConfig = z.infer<typeof UserProviderConfigSchema>

export const UserConfigSchema = z.record(z.string(), UserProviderConfigSchema)
export type UserConfig = z.infer<typeof UserConfigSchema>