import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Hono, type Context, type Next } from "hono"
import settingsRouter from "../src/routers/settings"
import {
  SystemModelSettingsService,
  SystemModelSettingsStore,
} from "../src/runtime/system-model-settings"
import type { ProviderInfo, ProviderModel, ProviderService } from "../src/provider"

function createModel(
  providerId: string,
  modelId: string,
  overrides: Partial<ProviderModel> = {}
): ProviderModel {
  return {
    id: modelId,
    provider_id: providerId,
    upstream_id: modelId,
    name: modelId,
    context_length: 128000,
    output_length: 4096,
    capabilities: {
      supports_tools: true,
      supports_vision: false,
      supports_reasoning: false,
      temperature: true,
    },
    cost: { input: 0, output: 0 },
    source: "custom",
    enabled: true,
    ...overrides,
  }
}

function createProvider(
  providerId: string,
  models: Record<string, ProviderModel>,
  overrides: Partial<ProviderInfo> = {}
): ProviderInfo {
  return {
    id: providerId,
    name: providerId,
    api_base: "https://example.test/v1",
    api_key: "test-key",
    enabled: true,
    source: "custom",
    api_protocol: "openai_compatible",
    models,
    ...overrides,
  }
}

function createProviderService(providers: ProviderInfo[]): ProviderService {
  const providerMap = new Map(providers.map((provider) => [provider.id, provider]))
  const modelMap = new Map<string, ProviderModel>()
  for (const provider of providers) {
    for (const model of Object.values(provider.models)) {
      modelMap.set(`${provider.id}/${model.id}`, model)
    }
  }

  return {
    getProvider: (providerId: string) => providerMap.get(providerId) ?? null,
    getModel: (providerId: string, modelId: string) =>
      modelMap.get(`${providerId}/${modelId}`) ?? null,
  } as unknown as ProviderService
}

async function createService(providerService: ProviderService): Promise<{
  dataDir: string
  service: SystemModelSettingsService
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-system-model-"))
  const service = new SystemModelSettingsService(
    new SystemModelSettingsStore(dataDir),
    providerService
  )
  await service.initialize()
  return { dataDir, service }
}

function createSettingsApp(service: SystemModelSettingsService): Hono {
  const app = new Hono()
  app.use("*", async (c: Context, next: Next) => {
    c.set("systemModelSettingsService", service)
    await next()
  })
  app.route("/", settingsRouter)
  return app
}

describe("system model settings", () => {
  test("store returns unset when file is missing and ignores invalid JSON", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-system-model-store-"))
    const store = new SystemModelSettingsStore(dataDir)

    expect(await store.load()).toEqual({ version: 1 })

    await writeFile(join(dataDir, "system-model-settings.json"), "{", "utf-8")

    expect(await store.load()).toEqual({ version: 1 })
  })

  test("service persists and resolves a configured system default model", async () => {
    const model = createModel("openai", "gpt-test")
    const provider = createProvider("openai", { [model.id]: model })
    const { dataDir, service } = await createService(createProviderService([provider]))

    const updated = await service.setSystemDefaultModel({
      providerId: "openai",
      modelId: "gpt-test",
    })

    expect(updated.status).toBe("configured")
    expect(updated.systemDefaultModel).toEqual({
      providerId: "openai",
      modelId: "gpt-test",
    })
    expect(updated.resolvedModel?.modelId).toBe("gpt-test")
    expect(JSON.parse(await readFile(join(dataDir, "system-model-settings.json"), "utf-8"))).toEqual({
      version: 1,
      systemDefaultModel: {
        providerId: "openai",
        modelId: "gpt-test",
      },
    })
  })

  test("router validates that the default model is callable and tool-capable", async () => {
    const disabledModel = createModel("openai", "disabled", { enabled: false })
    const noToolModel = createModel("openai", "no-tools", {
      capabilities: {
        supports_tools: false,
        supports_vision: false,
        supports_reasoning: false,
        temperature: true,
      },
    })
    const validModel = createModel("openai", "gpt-test")
    const provider = createProvider("openai", {
      [disabledModel.id]: disabledModel,
      [noToolModel.id]: noToolModel,
      [validModel.id]: validModel,
    })
    const { service } = await createService(createProviderService([provider]))
    const app = createSettingsApp(service)

    const disabledResponse = await app.request("/runtime/settings/model", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "openai", modelId: "disabled" }),
    })
    expect(disabledResponse.status).toBe(400)
    expect(await disabledResponse.json()).toMatchObject({
      error: { code: "SYSTEM_DEFAULT_MODEL_INVALID" },
    })

    const noToolsResponse = await app.request("/runtime/settings/model", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "openai", modelId: "no-tools" }),
    })
    expect(noToolsResponse.status).toBe(400)
    expect(await noToolsResponse.json()).toMatchObject({
      error: { code: "SYSTEM_DEFAULT_MODEL_INVALID" },
    })

    const validResponse = await app.request("/runtime/settings/model", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "openai", modelId: "gpt-test" }),
    })
    expect(validResponse.status).toBe(200)
    expect(await validResponse.json()).toMatchObject({
      status: "configured",
      systemDefaultModel: { providerId: "openai", modelId: "gpt-test" },
      resolvedModel: { providerId: "openai", modelId: "gpt-test" },
    })

    const deleteResponse = await app.request("/runtime/settings/model", {
      method: "DELETE",
    })
    expect(deleteResponse.status).toBe(200)
    expect(await deleteResponse.json()).toEqual({
      status: "unset",
    })
  })
})
