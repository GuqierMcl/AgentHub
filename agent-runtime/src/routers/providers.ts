import { Hono, Context } from 'hono'
import { ProviderService } from '../provider'
import type {
  ProviderConfigUpdateRequest,
  ModelConfigUpdateRequest,
  CustomProviderCreateRequest,
  CustomProviderUpdateRequest,
} from '../provider'
import {
  ProviderConfigUpdateRequestSchema,
  ModelConfigUpdateRequestSchema,
  CustomProviderCreateRequestSchema,
  CustomProviderUpdateRequestSchema,
} from '../provider'

// 扩展 Hono Context 类型
declare module 'hono' {
  interface ContextVariableMap {
    providerService: ProviderService
  }
}

const providers = new Hono()

// ── 序列化工具函数 ──

function serializeModel(m: any) {
  return {
    id: m.id,
    upstream_id: m.upstream_id,
    name: m.name,
    context_length: m.context_length,
    output_length: m.output_length,
    capabilities: {
      supports_tools: m.capabilities.supports_tools,
      supports_vision: m.capabilities.supports_vision,
      supports_reasoning: m.capabilities.supports_reasoning,
      temperature: m.capabilities.temperature,
    },
    cost: {
      input: m.cost.input,
      output: m.cost.output,
    },
    source: m.source,
    enabled: m.enabled,
  }
}

function serializeProviderSummary(p: any) {
  return {
    id: p.id,
    name: p.name,
    api_base: p.api_base,
    enabled: p.enabled,
    source: p.source,
    has_api_key: p.api_key !== null,
    model_count: Object.keys(p.models).length,
    api_protocol: p.api_protocol,
  }
}

function serializeProviderDetail(p: any) {
  return {
    id: p.id,
    name: p.name,
    api_base: p.api_base,
    enabled: p.enabled,
    source: p.source,
    has_api_key: p.api_key !== null,
    api_key: p.api_key,
    model_count: Object.keys(p.models).length,
    api_protocol: p.api_protocol,
    models: Object.fromEntries(
      Object.entries(p.models).map(([mid, m]: [string, any]) => [mid, serializeModel(m)])
    ),
  }
}

// ── 路由 ──

/**
 * GET /providers - 列出所有 provider
 */
providers.get('/providers', (c: Context) => {
  const service = c.get('providerService')
  const enabledOnly = c.req.query('enabled_only') === 'true'
  
  const providersList = service.listProviders(enabledOnly)
  return c.json({
    providers: providersList.map(serializeProviderSummary),
  })
})

/**
 * GET /providers/:id - 获取 provider 详情
 */
providers.get('/providers/:id', (c: Context) => {
  const service = c.get('providerService')
  const providerId = c.req.param('id')!
  
  const provider = service.getProvider(providerId)
  if (!provider) {
    return c.json({ error: `Provider ${providerId} not found` }, 404)
  }
  
  return c.json(serializeProviderDetail(provider))
})

/**
 * PUT /providers/:id/config - 更新 provider 配置
 */
providers.put('/providers/:id/config', async (c: Context) => {
  const service = c.get('providerService')
  const providerId = c.req.param('id')!
  
  const body = await c.req.json()
  const result = ProviderConfigUpdateRequestSchema.safeParse(body)
  if (!result.success) {
    return c.json({ error: 'Invalid request body', details: result.error.issues }, 400)
  }
  
  const provider = await service.updateProviderConfig(providerId, result.data)
  if (!provider) {
    return c.json({ error: `Provider ${providerId} not found` }, 404)
  }
  
  return c.json({
    id: provider.id,
    name: provider.name,
    api_base: provider.api_base,
    enabled: provider.enabled,
    has_api_key: provider.api_key !== null,
    api_protocol: provider.api_protocol,
  })
})

/**
 * PUT /providers/:id/models/:model_id/config - 更新模型配置
 */
providers.put('/providers/:id/models/:model_id/config', async (c: Context) => {
  const service = c.get('providerService')
  const providerId = c.req.param('id')!
  const modelId = c.req.param('model_id')!
  
  const body = await c.req.json()
  const result = ModelConfigUpdateRequestSchema.safeParse(body)
  if (!result.success) {
    return c.json({ error: 'Invalid request body', details: result.error.issues }, 400)
  }
  
  const model = await service.updateModelConfig(providerId, modelId, result.data)
  if (!model) {
    return c.json({ error: `Provider ${providerId} or model ${modelId} not found` }, 404)
  }
  
  return c.json(serializeModel(model))
})

/**
 * POST /custom-providers - 创建自定义 provider
 */
providers.post('/custom-providers', async (c: Context) => {
  const service = c.get('providerService')
  
  const body = await c.req.json()
  const result = CustomProviderCreateRequestSchema.safeParse(body)
  if (!result.success) {
    return c.json({ error: 'Invalid request body', details: result.error.issues }, 400)
  }
  
  try {
    const provider = await service.addCustomProvider(
      result.data.id,
      result.data.name,
      result.data.api_base,
      result.data.api_key,
      result.data.models
    )
    
    return c.json(serializeProviderDetail(provider), 201)
  } catch (error) {
    if (error instanceof Error && error.message.includes('already exists')) {
      return c.json({ error: error.message }, 409)
    }
    throw error
  }
})

/**
 * PUT /custom-providers/:id - 更新自定义 provider
 */
providers.put('/custom-providers/:id', async (c: Context) => {
  const service = c.get('providerService')
  const providerId = c.req.param('id')!
  
  const body = await c.req.json()
  const result = CustomProviderUpdateRequestSchema.safeParse(body)
  if (!result.success) {
    return c.json({ error: 'Invalid request body', details: result.error.issues }, 400)
  }
  
  const provider = await service.updateCustomProvider(providerId, result.data)
  if (!provider) {
    return c.json({ error: `Custom provider ${providerId} not found` }, 404)
  }
  
  return c.json(serializeProviderDetail(provider))
})

/**
 * DELETE /custom-providers/:id - 删除自定义 provider
 */
providers.delete('/custom-providers/:id', async (c: Context) => {
  const service = c.get('providerService')
  const providerId = c.req.param('id')!
  
  const removed = await service.removeCustomProvider(providerId)
  if (!removed) {
    return c.json({ error: `Custom provider ${providerId} not found or is a preset provider` }, 404)
  }
  
  return c.json({ deleted: true })
})

/**
 * POST /catalog/refresh - 刷新 models.dev 目录
 */
providers.post('/catalog/refresh', async (c: Context) => {
  const service = c.get('providerService')
  
  const providerCount = await service.refreshCatalog()
  
  return c.json({
    status: 'refreshed',
    provider_count: providerCount,
  })
})

export default providers