import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { readFile, writeFile } from "node:fs/promises"
import { z } from "zod"
import {
  AgentModelRefSchema,
  type AgentModelRef,
  type AgentResolvedModelResponse,
} from "../agents"
import type { ProviderModel, ProviderService } from "../provider"
import { resolveModelRefSnapshot } from "./model-resolver"

export const SystemModelSettingsFileSchema = z.object({
  version: z.literal(1).default(1),
  systemDefaultModel: AgentModelRefSchema.optional(),
}).strip()

export type SystemModelSettingsFile = z.infer<typeof SystemModelSettingsFileSchema>

export type SystemModelSettingsStatus = "configured" | "unset" | "invalid"

export type SystemModelSettingsResponse = {
  status: SystemModelSettingsStatus
  systemDefaultModel?: AgentModelRef
  resolvedModel?: AgentResolvedModelResponse
  invalidReason?: {
    code: string
    message: string
  }
}

export class SystemDefaultModelValidationError extends Error {
  constructor(
    public code: "SYSTEM_DEFAULT_MODEL_INVALID",
    message: string,
    public details?: unknown
  ) {
    super(message)
    this.name = "SystemDefaultModelValidationError"
  }
}

export class SystemModelSettingsStore {
  private settingsPath: string

  constructor(dataDir: string) {
    this.settingsPath = join(dataDir, "system-model-settings.json")
  }

  async load(): Promise<SystemModelSettingsFile> {
    if (!existsSync(this.settingsPath)) {
      return { version: 1 }
    }

    try {
      const content = await readFile(this.settingsPath, "utf-8")
      const parsed = JSON.parse(content)
      const result = SystemModelSettingsFileSchema.safeParse(parsed)
      if (!result.success) {
        console.warn(`Ignoring invalid system model settings file at ${this.settingsPath}:`, result.error)
        return { version: 1 }
      }

      return result.data
    } catch (error) {
      console.warn(`Ignoring unreadable system model settings file at ${this.settingsPath}:`, error)
      return { version: 1 }
    }
  }

  async save(settings: SystemModelSettingsFile): Promise<void> {
    const dataDir = dirname(this.settingsPath)
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }

    await writeFile(this.settingsPath, JSON.stringify(settings, null, 2), "utf-8")
  }
}

export class SystemModelSettingsService {
  private settings: SystemModelSettingsFile = { version: 1 }

  constructor(
    private store: SystemModelSettingsStore,
    private providerService: ProviderService
  ) {}

  async initialize(): Promise<void> {
    this.settings = await this.store.load()
  }

  getSystemDefaultModelRef(): AgentModelRef | null {
    const modelRef = this.settings.systemDefaultModel
    if (!modelRef) {
      return null
    }

    const validation = this.validateModelRef(modelRef)
    return validation.valid ? { ...modelRef } : null
  }

  getSettings(): SystemModelSettingsResponse {
    const modelRef = this.settings.systemDefaultModel
    if (!modelRef) {
      return { status: "unset" }
    }

    const validation = this.validateModelRef(modelRef)
    if (!validation.valid) {
      return {
        status: "invalid",
        systemDefaultModel: { ...modelRef },
        invalidReason: {
          code: validation.code,
          message: validation.message,
        },
      }
    }

    return {
      status: "configured",
      systemDefaultModel: { ...modelRef },
      resolvedModel: resolveModelRefSnapshot(this.providerService, modelRef, {
        modelSourceType: "system-default",
      }) ?? undefined,
    }
  }

  async setSystemDefaultModel(modelRef: AgentModelRef): Promise<SystemModelSettingsResponse> {
    const validation = this.validateModelRef(modelRef)
    if (!validation.valid) {
      throw new SystemDefaultModelValidationError(
        "SYSTEM_DEFAULT_MODEL_INVALID",
        validation.message,
        validation.details
      )
    }

    this.settings = {
      version: 1,
      systemDefaultModel: { ...modelRef },
    }
    await this.store.save(this.settings)
    return this.getSettings()
  }

  async clearSystemDefaultModel(): Promise<SystemModelSettingsResponse> {
    this.settings = { version: 1 }
    await this.store.save(this.settings)
    return { status: "unset" }
  }

  private validateModelRef(modelRef: AgentModelRef): ModelRefValidationResult {
    const provider = this.providerService.getProvider(modelRef.providerId)
    if (!provider) {
      return invalid("MODEL_PROVIDER_NOT_FOUND", `Provider ${modelRef.providerId} not found`, {
        providerId: modelRef.providerId,
      })
    }

    if (!provider.enabled) {
      return invalid("MODEL_DISABLED", `Provider ${provider.id} is disabled`, {
        providerId: provider.id,
      })
    }

    if (!provider.api_key) {
      return invalid("MODEL_PROVIDER_NOT_CALLABLE", `Provider ${provider.id} is missing an API key`, {
        providerId: provider.id,
      })
    }

    const model = this.providerService.getModel(modelRef.providerId, modelRef.modelId)
    if (!model) {
      return invalid("MODEL_NOT_FOUND", `Model ${modelRef.providerId}/${modelRef.modelId} not found`, {
        providerId: modelRef.providerId,
        modelId: modelRef.modelId,
      })
    }

    if (!model.enabled) {
      return invalid("MODEL_DISABLED", `Model ${modelRef.providerId}/${modelRef.modelId} is disabled`, {
        providerId: modelRef.providerId,
        modelId: modelRef.modelId,
      })
    }

    if (!isToolCapable(model)) {
      return invalid(
        "MODEL_TOOLS_UNSUPPORTED",
        `Model ${modelRef.providerId}/${modelRef.modelId} does not support tools`,
        {
          providerId: modelRef.providerId,
          modelId: modelRef.modelId,
        }
      )
    }

    return { valid: true }
  }
}

type ModelRefValidationResult =
  | { valid: true }
  | {
      valid: false
      code: string
      message: string
      details?: unknown
    }

function invalid(code: string, message: string, details?: unknown): ModelRefValidationResult {
  return {
    valid: false,
    code,
    message,
    details,
  }
}

function isToolCapable(model: ProviderModel): boolean {
  return model.capabilities.supports_tools
}
