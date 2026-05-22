import { join } from "node:path"
import { existsSync, mkdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { CatalogManager } from "./catalog"
import type {
  ModelsDevCatalog,
  ModelsDevProvider,
  ModelsDevModel,
  ProviderInfo,
  ProviderModel,
  ProviderProtocol,
  ModelCapabilities,
  ModelCost,
  UserConfig,
  UserProviderConfig,
} from "./types"
import {
  ProviderInfoSchema,
  ProviderModelSchema,
  UserConfigSchema,
} from "./types"

export class ProviderService {
  private dataDir: string
  private catalog: CatalogManager
  private providers: Map<string, ProviderInfo> = new Map()
  private models: Map<string, ProviderModel> = new Map() // key: "provider_id/model_id"
  private userConfigPath: string
  private initialized: boolean = false

  constructor(dataDir: string) {
    this.dataDir = dataDir
    this.catalog = new CatalogManager(dataDir)
    this.userConfigPath = join(dataDir, "providers.json")
  }

  /**
   * 初始化服务
   */
  async initialize(): Promise<void> {
    // 1. 加载 models.dev 目录
    const rawCatalog = await this.catalog.get()

    // 2. 标准化为内部结构
    for (const [providerId, raw] of Object.entries(rawCatalog)) {
      const info = this.fromModelsDevProvider(providerId, raw)
      if (info) {
        this.providers.set(providerId, info)
        for (const [modelId, model] of Object.entries(info.models)) {
          this.models.set(`${providerId}/${modelId}`, model)
        }
      }
    }

    // 3. 加载并应用用户配置
    const userConfig = await this.loadUserConfig()
    this.applyUserConfig(userConfig)

    this.initialized = true
  }

  /**
   * 刷新目录
   */
  async refreshCatalog(): Promise<number> {
    const rawCatalog = await this.catalog.refresh()

    // 清除现有数据
    this.providers.clear()
    this.models.clear()

    // 重新标准化
    for (const [providerId, raw] of Object.entries(rawCatalog)) {
      const info = this.fromModelsDevProvider(providerId, raw)
      if (info) {
        this.providers.set(providerId, info)
        for (const [modelId, model] of Object.entries(info.models)) {
          this.models.set(`${providerId}/${modelId}`, model)
        }
      }
    }

    // 重新应用用户配置
    const userConfig = await this.loadUserConfig()
    this.applyUserConfig(userConfig)

    return this.providers.size
  }

  /**
   * 列出所有 provider
   */
  listProviders(enabledOnly: boolean = false): ProviderInfo[] {
    const providers = Array.from(this.providers.values())
    if (enabledOnly) {
      return providers.filter(p => p.enabled && p.api_key)
    }
    return providers
  }

  /**
   * 获取 provider 详情
   */
  getProvider(providerId: string): ProviderInfo | null {
    return this.providers.get(providerId) ?? null
  }

  /**
   * 获取具体模型
   */
  getModel(providerId: string, modelId: string): ProviderModel | null {
    return this.models.get(`${providerId}/${modelId}`) ?? null
  }

  /**
   * 获取所有可用模型（有 key 且 enabled）
   */
  getAvailableModels(): Array<{ provider: ProviderInfo; model: ProviderModel }> {
    const result: Array<{ provider: ProviderInfo; model: ProviderModel }> = []
    for (const provider of this.providers.values()) {
      if (provider.enabled && provider.api_key) {
        for (const model of Object.values(provider.models)) {
          if (model.enabled) {
            result.push({ provider, model })
          }
        }
      }
    }
    return result
  }

  /**
   * 更新 provider 配置
   */
  async updateProviderConfig(
    providerId: string,
    config: { api_key?: string; enabled?: boolean; api_base?: string }
  ): Promise<ProviderInfo | null> {
    const provider = this.providers.get(providerId)
    if (!provider) {
      return null
    }

    // 更新字段
    if (config.api_key !== undefined) {
      provider.api_key = config.api_key || null
    }
    if (config.enabled !== undefined) {
      provider.enabled = config.enabled
    }
    if (config.api_base !== undefined) {
      provider.api_base = config.api_base
    }

    // 持久化
    await this.saveUserConfig()

    return provider
  }

  /**
   * 更新模型配置
   */
  async updateModelConfig(
    providerId: string,
    modelId: string,
    config: { enabled: boolean }
  ): Promise<ProviderModel | null> {
    const model = this.models.get(`${providerId}/${modelId}`)
    if (!model) {
      return null
    }

    model.enabled = config.enabled

    // 持久化
    await this.saveUserConfig()

    return model
  }

  /**
   * 添加自定义 provider
   */
  async addCustomProvider(
    providerId: string,
    name: string,
    apiBase: string,
    apiKey?: string,
    models?: Record<string, { name?: string; upstream_id?: string; context_length?: number; supports_tools?: boolean; supports_vision?: boolean }>
  ): Promise<ProviderInfo> {
    // 检查是否已存在
    if (this.providers.has(providerId)) {
      throw new Error(`Provider ${providerId} already exists`)
    }

    // 构建模型列表
    const providerModels: Record<string, ProviderModel> = {}
    if (models) {
      for (const [modelId, modelConfig] of Object.entries(models)) {
        const model: ProviderModel = {
          id: modelId,
          provider_id: providerId,
          upstream_id: modelConfig.upstream_id ?? modelId,
          name: modelConfig.name ?? modelId,
          context_length: modelConfig.context_length ?? 128000,
          output_length: 4096,
          capabilities: {
            supports_tools: modelConfig.supports_tools ?? false,
            supports_vision: modelConfig.supports_vision ?? false,
            supports_reasoning: false,
            temperature: true,
          },
          cost: { input: 0, output: 0 },
          source: "custom",
          enabled: true,
        }
        providerModels[modelId] = model
      }
    }

    // 创建 provider
    const provider: ProviderInfo = {
      id: providerId,
      name,
      api_base: apiBase,
      api_key: apiKey ?? null,
      enabled: true,
      source: "custom",
      api_protocol: "openai_compatible",
      models: providerModels,
    }

    this.providers.set(providerId, provider)
    for (const [modelId, model] of Object.entries(providerModels)) {
      this.models.set(`${providerId}/${modelId}`, model)
    }

    // 持久化
    await this.saveUserConfig()

    return provider
  }

  /**
   * 更新自定义 provider
   */
  async updateCustomProvider(
    providerId: string,
    config: { name?: string; api_base?: string; api_key?: string; models?: Record<string, { name?: string; upstream_id?: string; context_length?: number; supports_tools?: boolean; supports_vision?: boolean }> }
  ): Promise<ProviderInfo | null> {
    const provider = this.providers.get(providerId)
    if (!provider || provider.source !== "custom") {
      return null
    }

    // 更新字段
    if (config.name !== undefined) {
      provider.name = config.name
    }
    if (config.api_base !== undefined) {
      provider.api_base = config.api_base
    }
    if (config.api_key !== undefined) {
      provider.api_key = config.api_key || null
    }

    // 更新模型
    if (config.models) {
      // 清除旧模型
      for (const modelId of Object.keys(provider.models)) {
        this.models.delete(`${providerId}/${modelId}`)
      }
      provider.models = {}

      // 添加新模型
      for (const [modelId, modelConfig] of Object.entries(config.models)) {
        const model: ProviderModel = {
          id: modelId,
          provider_id: providerId,
          upstream_id: modelConfig.upstream_id ?? modelId,
          name: modelConfig.name ?? modelId,
          context_length: modelConfig.context_length ?? 128000,
          output_length: 4096,
          capabilities: {
            supports_tools: modelConfig.supports_tools ?? false,
            supports_vision: modelConfig.supports_vision ?? false,
            supports_reasoning: false,
            temperature: true,
          },
          cost: { input: 0, output: 0 },
          source: "custom",
          enabled: true,
        }
        provider.models[modelId] = model
        this.models.set(`${providerId}/${modelId}`, model)
      }
    }

    // 持久化
    await this.saveUserConfig()

    return provider
  }

  /**
   * 删除自定义 provider
   */
  async removeCustomProvider(providerId: string): Promise<boolean> {
    const provider = this.providers.get(providerId)
    if (!provider || provider.source !== "custom") {
      return false
    }

    // 清除模型
    for (const modelId of Object.keys(provider.models)) {
      this.models.delete(`${providerId}/${modelId}`)
    }

    this.providers.delete(providerId)

    // 持久化
    await this.saveUserConfig()

    return true
  }

  /**
   * 从 models.dev 数据转换为内部结构
   */
  private fromModelsDevProvider(providerId: string, raw: ModelsDevProvider): ProviderInfo | null {
    // 推导协议类型
    const apiProtocol = this.deriveProtocol(raw.npm)
    if (!apiProtocol) {
      return null // 不支持的 npm 值，过滤
    }

    // 转换模型
    const models: Record<string, ProviderModel> = {}
    for (const [modelId, rawModel] of Object.entries(raw.models)) {
      const model = this.fromModelsDevModel(providerId, modelId, rawModel)
      models[modelId] = model
    }

    return {
      id: providerId,
      name: raw.name,
      api_base: raw.api ?? "",
      api_key: null,
      enabled: false,
      source: "preset",
      api_protocol: apiProtocol,
      models,
    }
  }

  /**
   * 从 models.dev 模型数据转换为内部结构
   */
  private fromModelsDevModel(providerId: string, modelId: string, raw: ModelsDevModel): ProviderModel {
    // 判断是否支持视觉
    const supportsVision = raw.attachment || 
      (raw.modalities?.input ?? []).some(m => ["image", "video", "pdf"].includes(m))

    const capabilities: ModelCapabilities = {
      supports_tools: raw.tool_call ?? false,
      supports_vision: supportsVision,
      supports_reasoning: raw.reasoning ?? false,
      temperature: raw.temperature ?? true,
    }

    const cost: ModelCost = {
      input: raw.cost?.input ?? 0,
      output: raw.cost?.output ?? 0,
    }

    return {
      id: modelId,
      provider_id: providerId,
      upstream_id: raw.id,
      name: raw.name,
      context_length: raw.limit?.context ?? 128000,
      output_length: raw.limit?.output ?? 4096,
      capabilities,
      cost,
      source: "preset",
      enabled: true,
    }
  }

  /**
   * 推导协议类型
   */
  private deriveProtocol(npm?: string): ProviderProtocol | null {
    if (!npm) return "openai_compatible"
    
    switch (npm) {
      case "@ai-sdk/openai":
        return "openai"
      case "@ai-sdk/anthropic":
        return "anthropic"
      case "@ai-sdk/openai-compatible":
        return "openai_compatible"
      default:
        return null // 过滤不支持的
    }
  }

  /**
   * 应用用户配置
   */
  private applyUserConfig(userConfig: UserConfig): void {
    for (const [providerId, config] of Object.entries(userConfig)) {
      const provider = this.providers.get(providerId)

      if (provider) {
        // 预设 provider：应用配置
        if (config.api_key !== undefined) {
          provider.api_key = config.api_key
        }
        if (config.enabled !== undefined) {
          provider.enabled = config.enabled
        }
        if (config.api_base !== undefined) {
          provider.api_base = config.api_base
        }

        // 应用模型配置
        if (config.models) {
          for (const [modelId, modelConfig] of Object.entries(config.models)) {
            const model = provider.models[modelId]
            if (model) {
              if (modelConfig.enabled !== undefined) {
                model.enabled = modelConfig.enabled
              }
            }
          }
        }
      } else {
        // 自定义 provider：创建
        const models: Record<string, ProviderModel> = {}
        if (config.models) {
          for (const [modelId, modelConfig] of Object.entries(config.models)) {
            models[modelId] = {
              id: modelId,
              provider_id: providerId,
              upstream_id: modelConfig.upstream_id ?? modelId,
              name: modelConfig.name ?? modelId,
              context_length: modelConfig.context_length ?? 128000,
              output_length: 4096,
              capabilities: {
                supports_tools: modelConfig.supports_tools ?? false,
                supports_vision: modelConfig.supports_vision ?? false,
                supports_reasoning: false,
                temperature: true,
              },
              cost: { input: 0, output: 0 },
              source: "custom",
              enabled: modelConfig.enabled ?? true,
            }
          }
        }

        const provider: ProviderInfo = {
          id: providerId,
          name: config.name ?? providerId,
          api_base: config.api_base ?? "",
          api_key: config.api_key ?? null,
          enabled: config.enabled ?? true,
          source: "custom",
          api_protocol: "openai_compatible",
          models,
        }

        this.providers.set(providerId, provider)
        for (const [modelId, model] of Object.entries(models)) {
          this.models.set(`${providerId}/${modelId}`, model)
        }
      }
    }
  }

  /**
   * 加载用户配置
   */
  private async loadUserConfig(): Promise<UserConfig> {
    try {
      if (!existsSync(this.userConfigPath)) {
        return {}
      }

      const content = await readFile(this.userConfigPath, "utf-8")
      const data = JSON.parse(content)
      return UserConfigSchema.parse(data)
    } catch (error) {
      console.warn("Failed to load user config:", error)
      return {}
    }
  }

  /**
   * 保存用户配置
   */
  private async saveUserConfig(): Promise<void> {
    try {
      const userConfig: UserConfig = {}

      for (const [providerId, provider] of this.providers) {
        const config: UserProviderConfig = {}

        // 保存 provider 配置
        if (provider.source === "custom") {
          config.name = provider.name
          config.api_base = provider.api_base
          config.api_key = provider.api_key ?? undefined
          config.enabled = provider.enabled

          // 保存自定义模型
          const models: Record<string, any> = {}
          for (const [modelId, model] of Object.entries(provider.models)) {
            models[modelId] = {
              name: model.name,
              upstream_id: model.upstream_id,
              context_length: model.context_length,
              supports_tools: model.capabilities.supports_tools,
              supports_vision: model.capabilities.supports_vision,
              enabled: model.enabled,
            }
          }
          if (Object.keys(models).length > 0) {
            config.models = models
          }
        } else {
          // 预设 provider：只保存用户修改的字段
          if (provider.api_key) {
            config.api_key = provider.api_key
          }
          config.enabled = provider.enabled
          if (provider.api_base) {
            config.api_base = provider.api_base
          }

          // 保存模型启用状态
          const models: Record<string, any> = {}
          for (const [modelId, model] of Object.entries(provider.models)) {
            if (!model.enabled) {
              models[modelId] = { enabled: false }
            }
          }
          if (Object.keys(models).length > 0) {
            config.models = models
          }
        }

        userConfig[providerId] = config
      }

      // 确保目录存在
      if (!existsSync(this.dataDir)) {
        mkdirSync(this.dataDir, { recursive: true })
      }

      const content = JSON.stringify(userConfig, null, 2)
      await writeFile(this.userConfigPath, content, "utf-8")
    } catch (error) {
      console.warn("Failed to save user config:", error)
    }
  }
}