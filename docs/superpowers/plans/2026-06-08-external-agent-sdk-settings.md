# External Agent SDK Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users configure SDK-level runtime settings for AgentHub preset external agents on the Agents page, starting with OpenCode provider/model from the OpenCode SDK, Claude Code model and permissionMode, and Codex model only.

**Architecture:** Add a separate external-agent settings layer instead of reusing internal AgentHub provider model binding. Runtime owns validation, persistence, SDK option translation, and provider-specific model catalog lookup; HubServer only proxies product APIs; Web renders external settings separately from internal model binding. External platform global config, credentials, Skills, MCP, plugins, hooks, and provider files remain outside AgentHub control.

**Tech Stack:** TypeScript, Bun, Hono, React, Vite, shadcn/ui, `@opencode-ai/sdk`, `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`.

---

## Decisions And Scope

- OpenCode provider/model must come from OpenCode SDK/runtime catalog, not AgentHub ProviderService.
- Claude Code `permissionMode` is configurable, except `bypassPermissions` is blocked in this phase because it bypasses permission checks and requires `allowDangerouslySkipPermissions`.
- Codex uses minimum viable settings only: `model?: string`. Do not expose Codex sandbox, approval policy, reasoning effort, web search, app-server, or auth settings in this phase.
- Do not write OpenCode, Claude Code, or Codex global config files.
- Do not store provider credentials or auth tokens in HubServer or AgentHub data files.
- Do not register external native tools as AgentHub Runtime Tools.

## File Structure

- Modify `docs/external_agents/EXTERNAL_AGENT_ADAPTERS.md`: distinguish external global config from AgentHub SDK runtime overrides.
- Modify `docs/external_agents/OPENCODE_ADAPTER.md`: document OpenCode SDK model catalog and prompt-level model override.
- Modify `docs/external_agents/CLAUDE_CODE_ADAPTER.md`: document model and safe `permissionMode` runtime overrides.
- Modify `docs/external_agents/CODEX_ADAPTER.md`: document Codex model-only minimal override.
- Modify `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`: add Runtime and HubServer API contracts.
- Modify `agent-runtime/src/agents/types.ts`: add external settings schemas and response types.
- Create `agent-runtime/src/agents/external-agent-settings-store.ts`: persist `external-agent-settings.json`.
- Test `agent-runtime/src/agents/external-agent-settings-store.test.ts`: store load/save/default behavior.
- Modify `agent-runtime/src/agents/agent-registry.ts`: initialize settings store, overlay external settings, expose getter/setter.
- Test `agent-runtime/src/agents/agent-registry.test.ts`: external settings are allowed only for preset external agents and do not affect internal model binding.
- Modify `agent-runtime/src/routers/agents.ts`: add external settings routes and OpenCode model catalog route.
- Test `agent-runtime/src/routers/agents.test.ts`: API validation and serialization.
- Modify `agent-runtime/src/runtime/external-adapters/types.ts`: include resolved external settings in adapter context.
- Modify `agent-runtime/src/runtime/external-adapters/opencode-client.ts`: add `model` and `listModels`.
- Modify `agent-runtime/src/runtime/external-adapters/opencode-real-client.ts`: call OpenCode SDK provider catalog and pass `model` to `session.prompt`.
- Test `agent-runtime/src/runtime/external-adapters/opencode-real-client.test.ts`: prompt receives model override and catalog is normalized.
- Modify `agent-runtime/src/runtime/external-adapters/opencode-adapter.ts`: pass settings from context to client.
- Modify `agent-runtime/src/runtime/external-adapters/claude-code-client.ts`: add `model` and `permissionMode`.
- Modify `agent-runtime/src/runtime/external-adapters/claude-code-real-client.ts`: pass `model` and `permissionMode` to SDK `query`.
- Test `agent-runtime/src/runtime/external-adapters/claude-code-real-client.test.ts`: SDK query options include model and permissionMode.
- Modify `agent-runtime/src/runtime/external-adapters/claude-code-adapter.ts`: pass settings from context to client.
- Modify `agent-runtime/src/runtime/external-adapters/codex-client.ts`: add `model`.
- Modify `agent-runtime/src/runtime/external-adapters/codex-real-client.ts`: pass `model` into Codex `ThreadOptions`.
- Test `agent-runtime/src/runtime/external-adapters/codex-real-client.test.ts`: `startThread` and `resumeThread` receive model when configured.
- Modify `agent-runtime/src/runtime/external-adapters/codex-adapter.ts`: pass settings from context to client.
- Modify `hub-server/src/routers/agent.ts`: proxy external settings and OpenCode catalog endpoints.
- Test `hub-server/src/routers/agent.test.ts`: proxies reject browser-provided workspace roots and forward conversation-derived workspace snapshots.
- Modify `web/src/features/agents/types.ts`: add external settings and OpenCode model catalog types.
- Modify `web/src/features/agents/api/agents.ts`: add settings and catalog API calls.
- Create `web/src/features/agents/components/ExternalAgentSettingsPanel.tsx`: provider-specific settings UI.
- Modify `web/src/features/agents/components/AgentDetailsPanel.tsx`: render external settings for external agents.
- Modify `web/src/features/agents/components/AgentConfigurationForm.tsx`: keep internal model binding hidden for external agents and avoid mixing surfaces.
- Test `web/src/features/agents/components/ExternalAgentSettingsPanel.test.tsx`: option rendering, validation, save calls.

---

### Task 1: Documentation And Contract Update

**Files:**
- Modify: `docs/external_agents/EXTERNAL_AGENT_ADAPTERS.md`
- Modify: `docs/external_agents/OPENCODE_ADAPTER.md`
- Modify: `docs/external_agents/CLAUDE_CODE_ADAPTER.md`
- Modify: `docs/external_agents/CODEX_ADAPTER.md`
- Modify: `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`

- [ ] **Step 1: Update public design boundary**

Add this paragraph to `docs/external_agents/EXTERNAL_AGENT_ADAPTERS.md` after the current statement that AgentHub does not manage external platform internals:

```md
AgentHub may still keep a small SDK runtime override for AgentHub-originated runs. This override is not external platform configuration management: it is stored in AgentHub's Runtime data directory, is applied only when AgentHub calls the external SDK, and never writes provider credentials, global config files, Skills, MCP, plugins, hooks, or command definitions. External adapters must record which override was applied in diagnostic metadata and continue to report the model actually used by the provider when available.
```

- [ ] **Step 2: Document provider-specific scope**

Add provider sections:

```md
OpenCode: AgentHub may select `{ providerID, modelID }` only from an OpenCode SDK model catalog resolved for a workspace. The selector must not use AgentHub ProviderService models.

Claude Code: AgentHub may pass `model` and safe `permissionMode` values to `query({ options })`. `bypassPermissions` is out of scope for this phase.

Codex: AgentHub may pass only `model` into `ThreadOptions`. Other Codex SDK options stay fixed in this phase.
```

- [ ] **Step 3: Add API contract**

Add this contract to `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`:

```ts
type RuntimeExternalAgentSettings =
  | {
      provider: "opencode"
      model?: { providerID: string; modelID: string }
      executionAgent?: "build" | "plan"
    }
  | {
      provider: "claude-code"
      model?: string
      permissionMode?: "default" | "acceptEdits" | "plan" | "dontAsk" | "auto"
    }
  | {
      provider: "codex"
      model?: string
    }

type RuntimeExternalAgentSettingsResponse = {
  agentId: "opencode" | "claude-code" | "codex"
  settings: RuntimeExternalAgentSettings
  updatedAt?: string
}

type RuntimeOpenCodeModelCatalogRequest = {
  workspace: {
    workspaceId: string
    backendType: "local"
    rootPath: string
  }
}

type RuntimeOpenCodeModelCatalogResponse = {
  provider: "opencode"
  models: Array<{
    providerID: string
    providerName?: string
    modelID: string
    modelName?: string
  }>
  warnings: string[]
}
```

Document endpoints:

```text
GET /runtime/agents/:agentId/external-settings
PUT /runtime/agents/:agentId/external-settings
POST /runtime/agents/opencode/model-catalog

GET /api/runtime/agents/:agentId/external-settings
PUT /api/runtime/agents/:agentId/external-settings
POST /api/runtime/agents/opencode/model-catalog
```

- [ ] **Step 4: Commit docs**

Run:

```bash
git add docs/external_agents docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md
git commit -m "docs: define external agent SDK settings"
```

Expected: commit succeeds and only documentation files are staged.

---

### Task 2: Runtime External Settings Schema And Store

**Files:**
- Modify: `agent-runtime/src/agents/types.ts`
- Create: `agent-runtime/src/agents/external-agent-settings-store.ts`
- Create: `agent-runtime/src/agents/external-agent-settings-store.test.ts`
- Modify: `agent-runtime/src/agents/index.ts`

- [ ] **Step 1: Write failing store tests**

Create `agent-runtime/src/agents/external-agent-settings-store.test.ts`:

```ts
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, it } from "bun:test"
import { ExternalAgentSettingsStore } from "./external-agent-settings-store"

describe("ExternalAgentSettingsStore", () => {
  it("returns provider defaults when no settings file exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agenthub-external-settings-"))
    try {
      const store = new ExternalAgentSettingsStore(dir)
      await expect(store.loadSettings()).resolves.toEqual({})
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("saves and reloads provider-specific settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agenthub-external-settings-"))
    try {
      const store = new ExternalAgentSettingsStore(dir)
      await store.saveSettings({
        opencode: {
          provider: "opencode",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
          executionAgent: "build",
          updatedAt: "2026-06-08T00:00:00.000Z",
        },
        "claude-code": {
          provider: "claude-code",
          model: "sonnet",
          permissionMode: "plan",
          updatedAt: "2026-06-08T00:00:00.000Z",
        },
        codex: {
          provider: "codex",
          model: "gpt-5.1-codex",
          updatedAt: "2026-06-08T00:00:00.000Z",
        },
      })

      const reloaded = await store.loadSettings()
      expect(reloaded.opencode?.model?.providerID).toBe("anthropic")
      expect(reloaded["claude-code"]?.permissionMode).toBe("plan")
      expect(reloaded.codex?.model).toBe("gpt-5.1-codex")

      const raw = await readFile(join(dir, "external-agent-settings.json"), "utf8")
      expect(raw).toContain("\"version\": 1")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("drops invalid settings while preserving valid entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agenthub-external-settings-"))
    try {
      await Bun.write(join(dir, "external-agent-settings.json"), JSON.stringify({
        version: 1,
        settings: {
          opencode: { provider: "opencode", model: { providerID: "", modelID: "x" } },
          codex: { provider: "codex", model: "gpt-5.1-codex" },
        },
      }))
      const store = new ExternalAgentSettingsStore(dir)
      const settings = await store.loadSettings()
      expect(settings.opencode).toBeUndefined()
      expect(settings.codex?.model).toBe("gpt-5.1-codex")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
cd agent-runtime && bun test src/agents/external-agent-settings-store.test.ts
```

Expected: FAIL because `external-agent-settings-store.ts` does not exist.

- [ ] **Step 3: Add schemas to `types.ts`**

Add these exports near existing external agent config schemas:

```ts
export const ExternalAgentIdSchema = z.enum(["opencode", "claude-code", "codex"])
export type ExternalAgentId = z.infer<typeof ExternalAgentIdSchema>

export const OpenCodeExternalAgentSettingsSchema = z.object({
  provider: z.literal("opencode"),
  model: z.object({
    providerID: z.string().trim().min(1),
    modelID: z.string().trim().min(1),
  }).optional(),
  executionAgent: z.enum(["build", "plan"]).optional(),
  updatedAt: z.string().optional(),
}).strip()

export const ClaudeCodeExternalAgentSettingsSchema = z.object({
  provider: z.literal("claude-code"),
  model: z.string().trim().min(1).max(200).optional(),
  permissionMode: z.enum(["default", "acceptEdits", "plan", "dontAsk", "auto"]).optional(),
  updatedAt: z.string().optional(),
}).strip()

export const CodexExternalAgentSettingsSchema = z.object({
  provider: z.literal("codex"),
  model: z.string().trim().min(1).max(200).optional(),
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
```

- [ ] **Step 4: Implement store**

Create `agent-runtime/src/agents/external-agent-settings-store.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  ExternalAgentSettingsMapSchema,
  type ExternalAgentSettingsMap,
} from "./types"

const SETTINGS_FILE = "external-agent-settings.json"

type PersistedExternalAgentSettings = {
  version: 1
  settings: unknown
}

export class ExternalAgentSettingsStore {
  constructor(private readonly dataDir: string) {}

  async loadSettings(): Promise<ExternalAgentSettingsMap> {
    const path = this.settingsPath()
    let raw: string
    try {
      raw = await readFile(path, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {}
      }
      throw error
    }

    const parsed = JSON.parse(raw) as PersistedExternalAgentSettings
    const settings = typeof parsed === "object" && parsed && "settings" in parsed
      ? parsed.settings
      : {}

    const result = ExternalAgentSettingsMapSchema.safeParse(settings)
    if (result.success) {
      return result.data
    }

    const sanitized: ExternalAgentSettingsMap = {}
    const record = typeof settings === "object" && settings !== null
      ? settings as Record<string, unknown>
      : {}

    for (const agentId of ["opencode", "claude-code", "codex"] as const) {
      const item = ExternalAgentSettingsMapSchema.pick({ [agentId]: true }).safeParse({
        [agentId]: record[agentId],
      })
      if (item.success && item.data[agentId]) {
        sanitized[agentId] = item.data[agentId] as never
      }
    }

    return sanitized
  }

  async saveSettings(settings: ExternalAgentSettingsMap): Promise<void> {
    const normalized = ExternalAgentSettingsMapSchema.parse(settings)
    await mkdir(this.dataDir, { recursive: true })
    await writeFile(
      this.settingsPath(),
      `${JSON.stringify({ version: 1, settings: normalized }, null, 2)}\n`,
      "utf8"
    )
  }

  private settingsPath(): string {
    return join(this.dataDir, SETTINGS_FILE)
  }
}
```

- [ ] **Step 5: Export store**

Add to `agent-runtime/src/agents/index.ts`:

```ts
export { ExternalAgentSettingsStore } from "./external-agent-settings-store"
```

- [ ] **Step 6: Run store tests**

Run:

```bash
cd agent-runtime && bun test src/agents/external-agent-settings-store.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add agent-runtime/src/agents/types.ts agent-runtime/src/agents/index.ts agent-runtime/src/agents/external-agent-settings-store.ts agent-runtime/src/agents/external-agent-settings-store.test.ts
git commit -m "feat(runtime): persist external agent settings"
```

---

### Task 3: Agent Registry Overlay And Runtime APIs

**Files:**
- Modify: `agent-runtime/src/agents/types.ts`
- Modify: `agent-runtime/src/agents/agent-registry.ts`
- Modify: `agent-runtime/src/routers/agents.ts`
- Test: `agent-runtime/src/agents/agent-registry.test.ts`
- Test: `agent-runtime/src/routers/agents.test.ts`

- [ ] **Step 1: Add response fields**

Add to `AgentDefinitionSchema` in `agent-runtime/src/agents/types.ts`:

```ts
externalSettings: ExternalAgentSettingsSchema.optional(),
```

Add to `AgentDetailResponse`:

```ts
externalSettings?: ExternalAgentSettings
```

- [ ] **Step 2: Write registry tests**

Add tests to `agent-runtime/src/agents/agent-registry.test.ts`:

```ts
it("allows external SDK settings only for preset external agents", async () => {
  const registry = await createInitializedRegistry()
  await expect(registry.setExternalAgentSettings("opencode", {
    provider: "opencode",
    model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
    executionAgent: "build",
  })).resolves.toMatchObject({
    id: "opencode",
    externalSettings: {
      provider: "opencode",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
    },
  })

  await expect(registry.setExternalAgentSettings("coder", {
    provider: "codex",
    model: "gpt-5.1-codex",
  })).rejects.toMatchObject({
    code: "AGENT_EXTERNAL_SETTINGS_NOT_ALLOWED",
  })
})

it("keeps external SDK settings separate from internal model bindings", async () => {
  const registry = await createInitializedRegistry()
  await registry.setExternalAgentSettings("codex", {
    provider: "codex",
    model: "gpt-5.1-codex",
  })
  expect(registry.isModelBindingAllowed("codex")).toBe(false)
  expect(registry.getAgent("codex")?.modelRef).toBeUndefined()
  expect(registry.getAgent("codex")?.externalSettings).toEqual({
    provider: "codex",
    model: "gpt-5.1-codex",
    updatedAt: expect.any(String),
  })
})
```

- [ ] **Step 3: Implement registry methods**

In `agent-runtime/src/agents/agent-registry.ts`, add:

```ts
private externalSettingsStore: ExternalAgentSettingsStore
private externalSettings: ExternalAgentSettingsMap = {}
```

Initialize in constructor:

```ts
this.externalSettingsStore = new ExternalAgentSettingsStore(dataDir)
```

Load during `initialize()` after model bindings:

```ts
this.externalSettings = await this.externalSettingsStore.loadSettings()
```

Add methods:

```ts
getExternalAgentSettings(agentId: string): ExternalAgentSettings | undefined {
  return this.cloneExternalSettings(this.externalSettings[agentId as ExternalAgentId])
}

async setExternalAgentSettings(
  agentId: string,
  input: ExternalAgentSettingsUpdateRequest
): Promise<AgentDefinition> {
  return this.serializeMutation(async () => {
    const agent = this.agents.get(agentId)
    if (!agent || !this.canConfigureExternalSettings(agent, input.provider)) {
      throw new AgentRegistryMutationError(
        "AGENT_EXTERNAL_SETTINGS_NOT_ALLOWED",
        `Agent ${agentId} cannot configure external SDK settings`,
        { agentId, provider: input.provider },
        403
      )
    }

    const updatedSettings = {
      ...input,
      updatedAt: new Date().toISOString(),
    } as ExternalAgentSettings
    this.externalSettings[agentId as ExternalAgentId] = updatedSettings as never
    await this.externalSettingsStore.saveSettings(this.externalSettings)

    const baseAgent = this.baseAgents.get(agentId) ?? agent
    const updated = this.applyExternalSettings(this.applyModelBinding(baseAgent))
    this.agents.set(agentId, updated)
    return this.cloneAgent(updated)
  })
}

private canConfigureExternalSettings(agent: AgentDefinition, provider: string): boolean {
  return agent.origin === "external" &&
    agent.executorType === "external-adapter" &&
    agent.external?.provider === provider &&
    agent.id === provider
}

private applyExternalSettings(agent: AgentDefinition): AgentDefinition {
  if (agent.origin !== "external") return agent
  const settings = this.externalSettings[agent.id as ExternalAgentId]
  if (settings) {
    agent.externalSettings = this.cloneExternalSettings(settings)
  } else {
    delete agent.externalSettings
  }
  return agent
}

private cloneExternalSettings<T extends ExternalAgentSettings | undefined>(settings: T): T {
  return settings ? structuredClone(settings) as T : settings
}
```

Update all `this.agents.set(..., this.applyModelBinding(...))` call sites to wrap with `applyExternalSettings`.

- [ ] **Step 4: Add runtime routes**

In `agent-runtime/src/routers/agents.ts`, add:

```ts
agents.get("/runtime/agents/:agentId/external-settings", (c) => {
  const registry = c.get("agentRegistry")
  const agentId = c.req.param("agentId")!
  const agent = registry.getAgent(agentId)
  if (!agent || agent.origin !== "external" || !agent.external) {
    return agentNotFound(c, agentId)
  }

  return c.json(serializeExternalAgentSettings(agent))
})

agents.put("/runtime/agents/:agentId/external-settings", async (c) => {
  const registry = c.get("agentRegistry")
  const agentId = c.req.param("agentId")!
  const body = await readJsonBody(c)
  const result = ExternalAgentSettingsUpdateRequestSchema.safeParse(body)
  if (!result.success) {
    return agentInvalidInput(c, result.error.issues)
  }

  try {
    const updated = await registry.setExternalAgentSettings(agentId, result.data)
    return c.json(serializeExternalAgentSettings(updated))
  } catch (error) {
    return agentMutationFailed(c, error)
  }
})
```

Update `serializeAgentDetail`:

```ts
externalSettings: agent.externalSettings,
```

- [ ] **Step 5: Run registry and router tests**

Run:

```bash
cd agent-runtime && bun test src/agents/agent-registry.test.ts src/routers/agents.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent-runtime/src/agents agent-runtime/src/routers/agents.ts
git commit -m "feat(runtime): expose external agent settings"
```

---

### Task 4: OpenCode Model Catalog And Prompt Override

**Files:**
- Modify: `agent-runtime/src/runtime/external-adapters/opencode-client.ts`
- Modify: `agent-runtime/src/runtime/external-adapters/opencode-real-client.ts`
- Modify: `agent-runtime/src/runtime/external-adapters/opencode-adapter.ts`
- Modify: `agent-runtime/src/routers/agents.ts`
- Test: `agent-runtime/src/runtime/external-adapters/opencode-real-client.test.ts`
- Test: `agent-runtime/src/routers/agents.test.ts`

- [ ] **Step 1: Write failing OpenCode client tests**

Add to `opencode-real-client.test.ts`:

```ts
it("passes SDK model override to session.prompt", async () => {
  const promptCalls: unknown[] = []
  const client = createRealOpenCodeClientWithFakeServer({
    session: {
      prompt: async (input: unknown) => {
        promptCalls.push(input)
        return {
          info: { id: "msg_1", providerID: "anthropic", modelID: "claude-sonnet-4-5" },
          parts: [{ type: "text", text: "done" }],
        }
      },
    },
  })
  const session = await client.ensureSession(fakeOpenCodeSessionRequest())

  await Array.fromAsync(client.streamPrompt(fakeOpenCodePromptRequest({
    session,
    model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
  })))

  expect(promptCalls[0]).toMatchObject({
    model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
  })
})

it("normalizes OpenCode SDK provider catalog", async () => {
  const client = createRealOpenCodeClientWithFakeServer({
    provider: {
      list: async () => ({
        all: [{
          id: "anthropic",
          name: "Anthropic",
          models: {
            "claude-sonnet-4-5": { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
          },
        }],
      }),
    },
  })

  await expect(client.listModels("D:\\workspace")).resolves.toEqual({
    provider: "opencode",
    models: [{
      providerID: "anthropic",
      providerName: "Anthropic",
      modelID: "claude-sonnet-4-5",
      modelName: "Claude Sonnet 4.5",
    }],
    warnings: [],
  })
})
```

- [ ] **Step 2: Extend OpenCode types**

In `opencode-client.ts`, add:

```ts
export type OpenCodeModelOverride = {
  providerID: string
  modelID: string
}

export type OpenCodeModelCatalog = {
  provider: "opencode"
  models: Array<{
    providerID: string
    providerName?: string
    modelID: string
    modelName?: string
  }>
  warnings: string[]
}
```

Add to `OpenCodePromptRequest`:

```ts
model?: OpenCodeModelOverride
```

Add to `OpenCodeClient`:

```ts
listModels(workspaceRootPath: string): Promise<OpenCodeModelCatalog>
```

- [ ] **Step 3: Pass model to SDK prompt**

In `opencode-real-client.ts`, update `session.prompt`:

```ts
const promptInput = {
  sessionID: state.sessionId,
  directory: state.connection.directory,
  agent: executionAgent,
  ...(request.model ? { model: request.model } : {}),
  parts: [{
    type: "text" as const,
    text: request.prompt.content,
  }],
}

const promptPromise = state.connection.client.session.prompt(promptInput, {
  signal: request.signal,
}).finally(() => {
  promptSettled = true
  promptSettledAt = Date.now()
  wake()
})
```

- [ ] **Step 4: Implement model catalog**

Add to `RealOpenCodeClient`:

```ts
async listModels(workspaceRootPath: string): Promise<OpenCodeModelCatalog> {
  const connection = await this.server.ensure(workspaceRootPath)
  const response = await connection.client.provider.list({
    directory: connection.directory,
  })
  const catalog = unwrapOpenCodeResponse(response, "ADAPTER_PROMPT_FAILED", "OpenCode provider catalog failed")
  return {
    provider: "opencode",
    models: normalizeOpenCodeModelCatalog(catalog),
    warnings: [],
  }
}
```

Add helper:

```ts
function normalizeOpenCodeModelCatalog(catalog: unknown): OpenCodeModelCatalog["models"] {
  const record = getRecord(catalog)
  const providers = Array.isArray(record?.all) ? record.all : []
  return providers.flatMap((providerValue) => {
    const provider = getRecord(providerValue)
    const providerID = getRecordString(provider, "id")
    if (!providerID) return []
    const providerName = getRecordString(provider, "name")
    const models = getRecord(provider?.models)
    return Object.entries(models ?? {}).flatMap(([key, modelValue]) => {
      const model = getRecord(modelValue)
      const modelID = getRecordString(model, "id") ?? key
      if (!modelID) return []
      return [{
        providerID,
        ...(providerName ? { providerName } : {}),
        modelID,
        ...(getRecordString(model, "name") ? { modelName: getRecordString(model, "name") } : {}),
      }]
    })
  })
}
```

- [ ] **Step 5: Pass settings from adapter**

In `opencode-adapter.ts`, when calling `streamPrompt`, pass:

```ts
model: context.agent.externalSettings?.provider === "opencode"
  ? context.agent.externalSettings.model
  : undefined,
executionAgent: context.agent.externalSettings?.provider === "opencode"
  ? context.agent.externalSettings.executionAgent
  : undefined,
```

- [ ] **Step 6: Add runtime catalog route**

In `agent-runtime/src/routers/agents.ts`, add:

```ts
agents.post("/runtime/agents/opencode/model-catalog", async (c) => {
  const body = await readJsonBody(c)
  const result = RuntimeOpenCodeModelCatalogRequestSchema.safeParse(body)
  if (!result.success) {
    return agentInvalidInput(c, result.error.issues)
  }

  try {
    const catalog = await getDefaultOpenCodeClient().listModels(result.data.workspace.rootPath)
    return c.json(catalog)
  } catch (error) {
    return c.json({
      error: {
        code: "OPENCODE_MODEL_CATALOG_FAILED",
        message: error instanceof Error ? error.message : "Failed to load OpenCode model catalog",
      },
    }, 502)
  }
})
```

Add `RuntimeOpenCodeModelCatalogRequestSchema` to `types.ts` or a router-local schema:

```ts
const RuntimeOpenCodeModelCatalogRequestSchema = z.object({
  workspace: z.object({
    workspaceId: z.string().min(1),
    backendType: z.literal("local"),
    rootPath: z.string().min(1),
  }),
}).strip()
```

- [ ] **Step 7: Run OpenCode tests**

Run:

```bash
cd agent-runtime && bun test src/runtime/external-adapters/opencode-real-client.test.ts src/routers/agents.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add agent-runtime/src/runtime/external-adapters/opencode-* agent-runtime/src/routers/agents.ts agent-runtime/src/agents/types.ts
git commit -m "feat(runtime): configure OpenCode SDK model"
```

---

### Task 5: Claude Code Model And Permission Mode Override

**Files:**
- Modify: `agent-runtime/src/runtime/external-adapters/claude-code-client.ts`
- Modify: `agent-runtime/src/runtime/external-adapters/claude-code-real-client.ts`
- Modify: `agent-runtime/src/runtime/external-adapters/claude-code-adapter.ts`
- Test: `agent-runtime/src/runtime/external-adapters/claude-code-real-client.test.ts`

- [ ] **Step 1: Write failing Claude Code test**

Add:

```ts
it("passes model and permissionMode to Claude Agent SDK query options", async () => {
  const queryCalls: unknown[] = []
  const client = new RealClaudeCodeClient({
    query: (input) => {
      queryCalls.push(input)
      return fakeClaudeStream([{ type: "result", subtype: "success", result: "done" }])
    },
  })

  await Array.fromAsync(client.streamPrompt(fakeClaudeCodePromptRequest({
    model: "claude-sonnet-4-5",
    permissionMode: "plan",
  })))

  expect(queryCalls[0]).toMatchObject({
    options: {
      model: "claude-sonnet-4-5",
      permissionMode: "plan",
    },
  })
})
```

If `RealClaudeCodeClient` does not currently accept dependency injection, add it in this task:

```ts
export type RealClaudeCodeClientDependencies = {
  query?: typeof query
}

export class RealClaudeCodeClient implements ClaudeCodeClient {
  constructor(private readonly dependencies: RealClaudeCodeClientDependencies = {}) {}
}
```

- [ ] **Step 2: Extend request type**

In `claude-code-client.ts`, add:

```ts
export type ClaudeCodePermissionMode = "default" | "acceptEdits" | "plan" | "dontAsk" | "auto"
```

Add to `ClaudeCodePromptRequest`:

```ts
model?: string
permissionMode?: ClaudeCodePermissionMode
```

- [ ] **Step 3: Pass options**

In `claude-code-real-client.ts`, replace hardcoded permission mode:

```ts
const stream = (this.dependencies.query ?? query)({
  prompt: request.prompt.content,
  options: {
    cwd: request.cwd,
    abortController,
    includePartialMessages: true,
    permissionMode: request.permissionMode ?? "default",
    ...(request.model ? { model: request.model } : {}),
    ...(executablePath ? { pathToClaudeCodeExecutable: executablePath } : {}),
    ...(isResumableSessionId(request.session.providerSessionId)
      ? { resume: request.session.providerSessionId }
      : {}),
    canUseTool: this.createPermissionCallback(request),
    onUserDialog: async (dialog, options) => this.handleUserDialog(dialog, options.signal, request),
  },
})
```

- [ ] **Step 4: Pass settings from adapter**

In `claude-code-adapter.ts`, add:

```ts
const settings = context.agent.externalSettings?.provider === "claude-code"
  ? context.agent.externalSettings
  : undefined
```

Pass to client:

```ts
model: settings?.model,
permissionMode: settings?.permissionMode,
```

- [ ] **Step 5: Run Claude Code tests**

Run:

```bash
cd agent-runtime && bun test src/runtime/external-adapters/claude-code-real-client.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent-runtime/src/runtime/external-adapters/claude-code-*
git commit -m "feat(runtime): configure Claude Code SDK options"
```

---

### Task 6: Codex Model-Only Override

**Files:**
- Modify: `agent-runtime/src/runtime/external-adapters/codex-client.ts`
- Modify: `agent-runtime/src/runtime/external-adapters/codex-real-client.ts`
- Modify: `agent-runtime/src/runtime/external-adapters/codex-adapter.ts`
- Test: `agent-runtime/src/runtime/external-adapters/codex-real-client.test.ts`

- [ ] **Step 1: Write failing Codex tests**

Add:

```ts
it("passes model to startThread options", async () => {
  const startThreadCalls: unknown[] = []
  const client = new RealCodexClient({
    createSdk: () => ({
      startThread: (options) => {
        startThreadCalls.push(options)
        return fakeCodexThread({ id: "thread_1", finalResponse: "done" })
      },
      resumeThread: () => fakeCodexThread({ id: "thread_1", finalResponse: "done" }),
    }),
  })

  const session = await client.ensureSession(fakeCodexSessionRequest({
    model: "gpt-5.1-codex",
  }))

  expect(session.providerSessionId).toBe("thread_1")
  expect(startThreadCalls[0]).toMatchObject({
    workingDirectory: expect.any(String),
    sandboxMode: "workspace-write",
    networkAccessEnabled: true,
    model: "gpt-5.1-codex",
  })
})

it("passes model to resumeThread options", async () => {
  const resumeThreadCalls: unknown[] = []
  const client = new RealCodexClient({
    createSdk: () => ({
      startThread: () => fakeCodexThread({ id: "thread_new", finalResponse: "done" }),
      resumeThread: (id, options) => {
        resumeThreadCalls.push({ id, options })
        return fakeCodexThread({ id, finalResponse: "done" })
      },
    }),
  })

  await client.ensureSession(fakeCodexSessionRequest({
    providerSessionId: "thread_existing",
    model: "gpt-5.1-codex",
  }))

  expect(resumeThreadCalls[0]).toMatchObject({
    id: "thread_existing",
    options: { model: "gpt-5.1-codex" },
  })
})
```

- [ ] **Step 2: Extend request types**

In `codex-client.ts`, add `model?: string` to `CodexSessionRequest` and `CodexPromptRequest` only if prompt-side reconstruction needs it. Prefer session request only:

```ts
model?: string
```

- [ ] **Step 3: Pass model to thread options**

In `codex-real-client.ts`, change:

```ts
const threadOptions = this.createThreadOptions(request.workspaceRootPath, request.model)
```

And:

```ts
private createThreadOptions(workspaceRootPath: string, model?: string): Record<string, unknown> {
  return {
    workingDirectory: workspaceRootPath,
    sandboxMode: "workspace-write",
    networkAccessEnabled: true,
    ...(model ? { model } : {}),
  }
}
```

In `resolveThread`, use current request model only if it is added to `CodexPromptRequest`; otherwise keep existing behavior because `ensureSession()` already resumes the thread before prompt execution.

- [ ] **Step 4: Pass settings from adapter**

In `codex-adapter.ts`, add:

```ts
const settings = context.agent.externalSettings?.provider === "codex"
  ? context.agent.externalSettings
  : undefined
```

Pass to `ensureSession`:

```ts
model: settings?.model,
```

- [ ] **Step 5: Run Codex tests**

Run:

```bash
cd agent-runtime && bun test src/runtime/external-adapters/codex-real-client.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add agent-runtime/src/runtime/external-adapters/codex-*
git commit -m "feat(runtime): configure Codex model"
```

---

### Task 7: HubServer Proxies

**Files:**
- Modify: `hub-server/src/routers/agent.ts`
- Test: `hub-server/src/routers/agent.test.ts`

- [ ] **Step 1: Add proxy tests**

Create or update `hub-server/src/routers/agent.test.ts`:

```ts
it("proxies external agent settings update to Runtime", async () => {
  const app = createHubServerTestApp({
    runtimeForward: async (method, path, body) => {
      expect(method).toBe("PUT")
      expect(path).toBe("/runtime/agents/claude-code/external-settings")
      expect(body).toEqual({
        provider: "claude-code",
        model: "sonnet",
        permissionMode: "plan",
      })
      return {
        status: 200,
        data: {
          agentId: "claude-code",
          settings: { provider: "claude-code", model: "sonnet", permissionMode: "plan" },
          updatedAt: "2026-06-08T00:00:00.000Z",
        },
      }
    },
  })

  const res = await app.request("/api/runtime/agents/claude-code/external-settings", {
    method: "PUT",
    body: JSON.stringify({ provider: "claude-code", model: "sonnet", permissionMode: "plan" }),
    headers: { "Content-Type": "application/json" },
  })

  expect(res.status).toBe(200)
})

it("rejects browser-supplied OpenCode workspace roots", async () => {
  const app = createHubServerTestApp()
  const res = await app.request("/api/runtime/agents/opencode/model-catalog", {
    method: "POST",
    body: JSON.stringify({ workspace: { rootPath: "D:\\secret" } }),
    headers: { "Content-Type": "application/json" },
  })
  expect(res.status).toBe(400)
})
```

- [ ] **Step 2: Add settings proxy routes**

In `hub-server/src/routers/agent.ts`:

```ts
agent.get('/api/runtime/agents/:agentId/external-settings', async (c: Context) => {
  const client = c.get('runtimeClient')
  const agentId = c.req.param('agentId')!
  const { data, status } = await client.forward(
    'GET',
    `/runtime/agents/${encodeURIComponent(agentId)}/external-settings`,
    undefined,
    { raw: true }
  )
  return c.json(data, status)
})

agent.put('/api/runtime/agents/:agentId/external-settings', async (c: Context) => {
  const client = c.get('runtimeClient')
  const agentId = c.req.param('agentId')!
  const body = await c.req.json().catch(() => null)
  const { data, status } = await client.forward(
    'PUT',
    `/runtime/agents/${encodeURIComponent(agentId)}/external-settings`,
    body,
    { raw: true }
  )
  return c.json(data, status)
})
```

- [ ] **Step 3: Add OpenCode catalog proxy without accepting rootPath from browser**

Add a request schema that accepts only `conversationId`:

```ts
const OpenCodeModelCatalogBrowserRequestSchema = z.object({
  conversationId: z.string().min(1),
}).strip()
```

Proxy implementation:

```ts
agent.post('/api/runtime/agents/opencode/model-catalog', async (c: Context) => {
  const parsed = OpenCodeModelCatalogBrowserRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({
      error: {
        code: 'OPENCODE_MODEL_CATALOG_INVALID_INPUT',
        message: 'conversationId is required to resolve a workspace for OpenCode model catalog',
        details: parsed.error.issues,
      },
    }, 400)
  }

  const workspace = await resolveConversationWorkspaceSnapshot(c, parsed.data.conversationId)
  if (!workspace) {
    return c.json({
      error: {
        code: 'WORKSPACE_NOT_RESOLVED',
        message: 'Conversation is not bound to a local workspace',
      },
    }, 400)
  }

  const client = c.get('runtimeClient')
  const { data, status } = await client.forward(
    'POST',
    '/runtime/agents/opencode/model-catalog',
    { workspace },
    { raw: true }
  )
  return c.json(data, status)
})
```

Use the existing conversation workspace resolver used by capability or workspace APIs. If no shared helper exists, create `hub-server/src/workspaces/conversation-workspace.ts` with a single exported `resolveConversationWorkspaceSnapshot()` and move existing duplicate logic there in the same task.

- [ ] **Step 4: Run HubServer tests**

Run:

```bash
cd hub-server && bun test src/routers/agent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hub-server/src/routers/agent.ts hub-server/src/routers/agent.test.ts hub-server/src/workspaces
git commit -m "feat(server): proxy external agent settings"
```

---

### Task 8: Agents Page UI

**Files:**
- Modify: `web/src/features/agents/types.ts`
- Modify: `web/src/features/agents/api/agents.ts`
- Create: `web/src/features/agents/components/ExternalAgentSettingsPanel.tsx`
- Modify: `web/src/features/agents/components/AgentDetailsPanel.tsx`
- Modify: `web/src/features/agents/components/AgentConfigurationForm.tsx`
- Test: `web/src/features/agents/components/ExternalAgentSettingsPanel.test.tsx`

- [ ] **Step 1: Add web types**

In `web/src/features/agents/types.ts`:

```ts
export type ExternalAgentSettings =
  | {
      provider: "opencode"
      model?: { providerID: string; modelID: string }
      executionAgent?: "build" | "plan"
      updatedAt?: string
    }
  | {
      provider: "claude-code"
      model?: string
      permissionMode?: "default" | "acceptEdits" | "plan" | "dontAsk" | "auto"
      updatedAt?: string
    }
  | {
      provider: "codex"
      model?: string
      updatedAt?: string
    }

export type OpenCodeModelCatalogItem = {
  providerID: string
  providerName?: string
  modelID: string
  modelName?: string
}

export type ExternalAgentSettingsResponse = {
  agentId: "opencode" | "claude-code" | "codex"
  settings: ExternalAgentSettings
  updatedAt?: string
}
```

Add to `AgentDetail`:

```ts
externalSettings?: ExternalAgentSettings
```

- [ ] **Step 2: Add API methods**

In `web/src/features/agents/api/agents.ts`:

```ts
externalSettings(agentId: string): Promise<ExternalAgentSettingsResponse> {
  return request(`/api/runtime/agents/${encodeURIComponent(agentId)}/external-settings`)
},

updateExternalSettings(agentId: string, input: ExternalAgentSettings): Promise<ExternalAgentSettingsResponse> {
  return request(`/api/runtime/agents/${encodeURIComponent(agentId)}/external-settings`, {
    method: "PUT",
    body: JSON.stringify(input),
  })
},

openCodeModelCatalog(conversationId: string): Promise<{ models: OpenCodeModelCatalogItem[]; warnings: string[] }> {
  return request("/api/runtime/agents/opencode/model-catalog", {
    method: "POST",
    body: JSON.stringify({ conversationId }),
  })
},
```

- [ ] **Step 3: Create settings panel**

Create `ExternalAgentSettingsPanel.tsx` with provider-specific controls:

```tsx
import { useState } from "react"
import { SaveIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { agentsApi } from "../api/agents"
import type { AgentDetail, ExternalAgentSettings } from "../types"

type Props = {
  agent: AgentDetail
  conversationId?: string
  onSaved: (agent: AgentDetail) => void
}

export function ExternalAgentSettingsPanel({ agent, conversationId, onSaved }: Props) {
  const provider = agent.external?.provider
  const [saving, setSaving] = useState(false)
  const [modelText, setModelText] = useState(
    agent.externalSettings?.provider === "claude-code" || agent.externalSettings?.provider === "codex"
      ? agent.externalSettings.model ?? ""
      : ""
  )
  const [permissionMode, setPermissionMode] = useState(
    agent.externalSettings?.provider === "claude-code"
      ? agent.externalSettings.permissionMode ?? "default"
      : "default"
  )
  const [openCodeProviderID, setOpenCodeProviderID] = useState(
    agent.externalSettings?.provider === "opencode"
      ? agent.externalSettings.model?.providerID ?? ""
      : ""
  )
  const [openCodeModelID, setOpenCodeModelID] = useState(
    agent.externalSettings?.provider === "opencode"
      ? agent.externalSettings.model?.modelID ?? ""
      : ""
  )
  const [executionAgent, setExecutionAgent] = useState(
    agent.externalSettings?.provider === "opencode"
      ? agent.externalSettings.executionAgent ?? "build"
      : "build"
  )

  async function save() {
    if (!provider) return
    setSaving(true)
    try {
      const input = buildSettingsInput(provider)
      const saved = await agentsApi.updateExternalSettings(agent.id, input)
      onSaved({ ...agent, externalSettings: saved.settings })
      toast.success("外部智能体配置已保存")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存外部智能体配置失败")
    } finally {
      setSaving(false)
    }
  }

  function buildSettingsInput(providerId: string): ExternalAgentSettings {
    if (providerId === "opencode") {
      return {
        provider: "opencode",
        executionAgent: executionAgent as "build" | "plan",
        ...(openCodeProviderID.trim() && openCodeModelID.trim()
          ? { model: { providerID: openCodeProviderID.trim(), modelID: openCodeModelID.trim() } }
          : {}),
      }
    }
    if (providerId === "claude-code") {
      return {
        provider: "claude-code",
        ...(modelText.trim() ? { model: modelText.trim() } : {}),
        permissionMode: permissionMode as ExternalAgentSettings & { provider: "claude-code" }["permissionMode"],
      }
    }
    return {
      provider: "codex",
      ...(modelText.trim() ? { model: modelText.trim() } : {}),
    }
  }

  if (provider === "opencode") {
    return (
      <section className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input value={openCodeProviderID} onChange={(event) => setOpenCodeProviderID(event.currentTarget.value)} placeholder="providerID" />
          <Input value={openCodeModelID} onChange={(event) => setOpenCodeModelID(event.currentTarget.value)} placeholder="modelID" />
        </div>
        <Select value={executionAgent} onValueChange={setExecutionAgent}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="build">Build</SelectItem>
            <SelectItem value="plan">Plan</SelectItem>
          </SelectContent>
        </Select>
        <Button disabled={saving} onClick={save}><SaveIcon data-icon="inline-start" />保存</Button>
      </section>
    )
  }

  if (provider === "claude-code") {
    return (
      <section className="flex flex-col gap-3">
        <Input value={modelText} onChange={(event) => setModelText(event.currentTarget.value)} placeholder="model" />
        <Select value={permissionMode} onValueChange={setPermissionMode}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">default</SelectItem>
            <SelectItem value="acceptEdits">acceptEdits</SelectItem>
            <SelectItem value="plan">plan</SelectItem>
            <SelectItem value="dontAsk">dontAsk</SelectItem>
            <SelectItem value="auto">auto</SelectItem>
          </SelectContent>
        </Select>
        <Button disabled={saving} onClick={save}><SaveIcon data-icon="inline-start" />保存</Button>
      </section>
    )
  }

  if (provider === "codex") {
    return (
      <section className="flex flex-col gap-3">
        <Input value={modelText} onChange={(event) => setModelText(event.currentTarget.value)} placeholder="model" />
        <Button disabled={saving} onClick={save}><SaveIcon data-icon="inline-start" />保存</Button>
      </section>
    )
  }

  return null
}
```

If the app already has a model selection dialog pattern for agent model binding, reuse the dialog shell but keep this provider-specific content and API separate.

- [ ] **Step 4: Wire into details panel**

In `AgentDetailsPanel.tsx`, render after the agent summary for external agents:

```tsx
{agent.origin === "external" ? (
  <ExternalAgentSettingsPanel
    agent={agent}
    conversationId={selectedConversationId}
    onSaved={onAgentUpdated}
  />
) : null}
```

Use existing state update callbacks in `AgentsWorkspace.tsx`; if none exists, add:

```ts
function handleAgentUpdated(updated: AgentDetail) {
  setAgents((current) => current.map((agent) => agent.id === updated.id ? updated : agent))
  setSelectedAgent(updated)
}
```

- [ ] **Step 5: Keep internal model binding separate**

Leave this condition in `AgentConfigurationForm.tsx` unchanged:

```tsx
{isEdit && agent && agent.origin !== "external" ? (
```

The external settings panel is the only external configuration surface in this phase.

- [ ] **Step 6: Run web typecheck and tests**

Run:

```bash
cd web && bunx tsc --noEmit -p tsconfig.app.json
cd web && bun test src/features/agents/components/ExternalAgentSettingsPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/agents
git commit -m "feat(web): configure external agent SDK settings"
```

---

### Task 9: End-To-End Verification

**Files:**
- No new files expected.

- [ ] **Step 1: Runtime focused tests**

Run:

```bash
cd agent-runtime && bun test src/agents src/routers/agents.test.ts src/runtime/external-adapters
```

Expected: PASS.

- [ ] **Step 2: HubServer focused tests**

Run:

```bash
cd hub-server && bun test src/routers/agent.test.ts
```

Expected: PASS.

- [ ] **Step 3: Web checks**

Run:

```bash
cd web && bun run lint
cd web && bunx tsc --noEmit -p tsconfig.app.json
```

Expected: PASS.

- [ ] **Step 4: Optional real smoke tests**

Run only when local SDK credentials and CLIs are available:

```bash
cd agent-runtime && AGENTHUB_OPENCODE_PROMPT_SMOKE=1 bun test src/runtime/external-adapters/opencode-real-client.test.ts
cd agent-runtime && AGENTHUB_CLAUDE_CODE_SMOKE=1 bun test src/runtime/external-adapters/claude-code-real-client.test.ts
cd agent-runtime && AGENTHUB_CODEX_PROMPT_SMOKE=1 bun test src/runtime/external-adapters/codex-real-client.test.ts
```

Expected: PASS or SKIP when env vars are absent. Real smoke tests must use temporary workspaces only.

- [ ] **Step 5: Manual UI smoke**

Run:

```bash
bun run dev:server
bun run dev:web
```

Expected:

- Agents page shows external settings for OpenCode, Claude Code, and Codex.
- Internal model binding remains available only for internal visible primary agents.
- Saving Claude Code `model = sonnet`, `permissionMode = plan` updates the details panel after reload.
- Saving Codex `model = gpt-5.1-codex` updates the details panel after reload.
- Saving OpenCode `providerID/modelID` updates the details panel and does not call AgentHub provider APIs.

- [ ] **Step 6: Final commit**

```bash
git status --short
git commit -m "feat: add external agent SDK settings"
```

Expected: commit succeeds if all previous tasks were intentionally squashed; otherwise skip this step because task-level commits already exist.

---

## Self-Review

- Spec coverage: OpenCode SDK-owned provider/model, Claude Code permissionMode, and Codex model-only minimal configuration are covered.
- Scope control: No task writes external platform config, stores credentials, exposes Codex advanced options, or reuses AgentHub ProviderService for OpenCode.
- Type consistency: Provider IDs use OpenCode SDK casing `providerID/modelID`; AgentHub internal `providerId/modelId` remains separate.
- Risk control: `bypassPermissions` is intentionally absent from the Claude Code enum in this phase.
