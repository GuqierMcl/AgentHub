# Runtime Skill Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Agent Runtime safely inject selected discovered Skill instructions into internal AI SDK and Orchestrator prompt assembly without executing Skills, starting MCP servers, or exposing Skill bodies in normal chat output.

**Architecture:** Phase 1/2 already provide read-only Skill/MCP discovery. Phase 4A adds `allowedSkills` to Runtime agent definitions, resolves selected Skill bodies at Run execution time through an internal-only resolver, formats them as bounded system prompt context, and optionally emits metadata-only diagnostics. Workspace Skills remain discoverable but are not injectable for user agents until an explicit workspace trust contract exists.

**Tech Stack:** TypeScript, Bun, Hono, Zod, AI SDK, existing Agent Runtime `CapabilityDiscoveryService`, existing `RunManager` execution context.

---

## Scope And Decisions

- Implement Runtime-only Phase 4A.
- Include internal AI SDK agents and Orchestrator.
- Exclude Web UI, HubServer API changes, MCP execution, Skill installation, Skill config writes, external adapter native Skill controls, and workspace Skill trust prompts.
- Store `allowedSkills` as logical discovery refs such as `global:agents:review-skill` or `global:codex:.system:openai-docs`.
- User-created agents may only persist `global:*` Skill refs in this phase.
- System preset agents may define `allowedSkills` in code, but this plan does not require assigning preset Skills yet.
- Runtime reads Skill bodies only while building execution context for a Run. Discovery APIs continue returning metadata only.
- Skill body limits:
  - per Skill body max: 12000 characters
  - total injected body max: 40000 characters
  - Skill count max per agent: 20
- Relative references in Skill markdown are parsed into metadata but not expanded in this phase.
- Inline shell snippets are never executed. Shell-like fenced code blocks may be passed as instruction text, with a warning in diagnostic metadata.

## Files

- Modify: `D:/PyWorkSpace/AgentHub/docs/architecture/AGENT_RUNTIME.md`
- Modify: `D:/PyWorkSpace/AgentHub/docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`
- Modify: `D:/PyWorkSpace/AgentHub/docs/roadmap/skill-mcp-capability-discovery.md`
- Modify: `D:/PyWorkSpace/AgentHub/agent-runtime/src/agents/types.ts`
- Modify: `D:/PyWorkSpace/AgentHub/agent-runtime/src/agents/agent-registry.ts`
- Modify: `D:/PyWorkSpace/AgentHub/agent-runtime/src/routers/agents.ts`
- Modify: `D:/PyWorkSpace/AgentHub/agent-runtime/src/runtime/types.ts`
- Modify: `D:/PyWorkSpace/AgentHub/agent-runtime/src/runtime/capabilities.ts`
- Create: `D:/PyWorkSpace/AgentHub/agent-runtime/src/runtime/skill-content.ts`
- Create: `D:/PyWorkSpace/AgentHub/agent-runtime/src/runtime/skill-prompt.ts`
- Modify: `D:/PyWorkSpace/AgentHub/agent-runtime/src/runtime/ai-sdk-executor.ts`
- Modify: `D:/PyWorkSpace/AgentHub/agent-runtime/src/runtime/orchestrator-executor.ts`
- Modify: `D:/PyWorkSpace/AgentHub/agent-runtime/src/runtime/run-manager.ts`
- Modify: `D:/PyWorkSpace/AgentHub/agent-runtime/src/runtime/index.ts`
- Modify: `D:/PyWorkSpace/AgentHub/agent-runtime/src/index.ts`
- Test: `D:/PyWorkSpace/AgentHub/agent-runtime/test/agent-skill-configuration.test.ts`
- Test: `D:/PyWorkSpace/AgentHub/agent-runtime/test/skill-content.test.ts`
- Test: `D:/PyWorkSpace/AgentHub/agent-runtime/test/skill-prompt.test.ts`
- Test: `D:/PyWorkSpace/AgentHub/agent-runtime/test/pinned-messages.test.ts`

## Task 1: Contract And Boundary Docs

**Files:**
- Modify: `docs/architecture/AGENT_RUNTIME.md`
- Modify: `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`
- Modify: `docs/roadmap/skill-mcp-capability-discovery.md`

- [ ] **Step 1: Update Runtime architecture doc**

Add a short subsection under the Runtime capability discovery paragraph:

```markdown
#### Phase 4A Skill 注入边界

Runtime 可以在内部 AI SDK / Orchestrator Run 的 prompt assembly 阶段读取 `allowedSkills` 指向的有效 Skill 正文，并以 system prompt 区块注入给模型。该能力仍然不执行 Skill、不会启动 MCP server、不会扩展外部 agent 的 native Skill 开关，也不会把 Skill 正文返回给 HubServer 或前端消息流。

本阶段用户自定义智能体只允许引用 global Skill。workspace Skill 仍可被 discovery API 展示，但在缺少显式 workspace trust contract 前不会被用户自定义智能体注入。Runtime 只在诊断事件中返回 Skill id/name/source/level、截断状态和 warning，不返回正文。
```

- [ ] **Step 2: Update Runtime API contract**

Add `allowedSkills` to the Agent Definition section and add the diagnostic event contract:

```ts
type AgentDefinition = {
  allowedSkills: string[]
}

type AgentSkillContextResolvedEvent = {
  type: "agent.skill_context.resolved"
  data: {
    status: "resolved" | "partial" | "skipped"
    skills: Array<{
      id: string
      ref: string
      name: string
      source: "agents" | "codex" | "claude-code" | "opencode"
      level: "global" | "workspace"
      truncated: boolean
      contentChars: number
      relativeRefs: string[]
      warnings: string[]
    }>
    warnings: string[]
  }
}
```

Also record that `RunDiagnosticsSchema` gains:

```ts
type RunDiagnostics = {
  includeSkillDiagnostics?: boolean
}
```

- [ ] **Step 3: Update roadmap progress**

In `docs/roadmap/skill-mcp-capability-discovery.md`, update Phase 4 with Phase 4A bullets:

```markdown
- Phase 4A 先实现 Runtime-only 的 global Skill 注入闭环。
- 用户自定义 agent 的 workspace Skill 注入等待 workspace trust contract。
- Runtime 诊断事件只返回 Skill 元数据，不返回正文。
```

- [ ] **Step 4: Commit docs**

Run:

```powershell
git add docs/architecture/AGENT_RUNTIME.md docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md docs/roadmap/skill-mcp-capability-discovery.md
git commit -m "docs: define runtime skill injection boundary"
```

Expected: commit succeeds on `main`.

## Task 2: Agent Definition `allowedSkills`

**Files:**
- Modify: `agent-runtime/src/agents/types.ts`
- Modify: `agent-runtime/src/agents/agent-registry.ts`
- Modify: `agent-runtime/src/routers/agents.ts`
- Test: `agent-runtime/test/agent-skill-configuration.test.ts`

- [ ] **Step 1: Write failing schema and registry tests**

Create `agent-runtime/test/agent-skill-configuration.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentDefinitionSchema, AgentRegistry } from "../src/agents"
import { createDefaultRuntimeToolRegistry } from "../src/runtime"

async function createRegistry(): Promise<AgentRegistry> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-skill-config-"))
  const registry = new AgentRegistry(dataDir, createDefaultRuntimeToolRegistry())
  await registry.initialize()
  return registry
}

describe("agent skill configuration", () => {
  test("AgentDefinitionSchema defaults allowedSkills to an empty array", () => {
    const parsed = AgentDefinitionSchema.parse({
      id: "skill_test",
      name: "Skill Test",
      description: "Tests allowedSkills",
      tier: "primary",
      origin: "user",
      visibility: "visible",
      entryPolicy: "callable",
      delegationPolicy: "can-delegate",
      executorType: "ai-sdk",
      capabilities: [],
      allowedSubagents: [],
      allowedTools: [],
      permissionPolicy: {
        filesystem: "none",
        shell: "none",
        network: "none",
        deploy: "none",
      },
    })

    expect(parsed.allowedSkills).toEqual([])
  })

  test("user agents preserve normalized global allowedSkills", async () => {
    const registry = await createRegistry()
    const agent = await registry.createUserAgent({
      id: "skill_user",
      name: "Skill User",
      description: "Uses selected Skills",
      systemPrompt: "Use approved instructions.",
      capabilities: [],
      allowedSubagents: [],
      allowedTools: [],
      allowedSkills: [
        " global:agents:review ",
        "global:agents:review",
        "global:codex:.system:openai-docs",
      ],
      enabled: true,
    })

    expect(agent.allowedSkills).toEqual([
      "global:agents:review",
      "global:codex:.system:openai-docs",
    ])
  })

  test("user agents reject workspace allowedSkills until trust exists", async () => {
    const registry = await createRegistry()

    await expect(registry.createUserAgent({
      id: "workspace_skill_user",
      name: "Workspace Skill User",
      description: "Rejected for now",
      systemPrompt: "Use approved instructions.",
      capabilities: [],
      allowedSubagents: [],
      allowedTools: [],
      allowedSkills: ["workspace:agents:local-review"],
      enabled: true,
    })).rejects.toMatchObject({
      code: "AGENT_INVALID_INPUT",
      status: 400,
    })
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test test/agent-skill-configuration.test.ts
```

Expected: fail because `allowedSkills` does not exist in schemas and registry.

- [ ] **Step 3: Extend agent types**

In `agent-runtime/src/agents/types.ts`, add:

```ts
export const AgentSkillRefSchema = z.string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^(global|workspace):(agents|codex|claude-code|opencode):[A-Za-z0-9._:-]+$/, "Skill refs must be logical capability refs")
export type AgentSkillRef = z.infer<typeof AgentSkillRefSchema>
```

Then add `allowedSkills` to schemas and response types:

```ts
allowedSkills: z.array(AgentSkillRefSchema).default([]),
```

Add to create request:

```ts
allowedSkills: z.array(AgentSkillRefSchema).max(20).default([]),
```

Add to update request:

```ts
allowedSkills: z.array(AgentSkillRefSchema).max(20).optional(),
```

Add to `AgentDetailResponse`:

```ts
allowedSkills: string[]
```

- [ ] **Step 4: Normalize user agent Skill refs**

In `agent-runtime/src/agents/agent-registry.ts`, add helper:

```ts
private normalizeAllowedSkills(skillRefs: string[], options: { allowWorkspace: boolean } = { allowWorkspace: false }): string[] {
  const normalized = this.normalizeStringList(skillRefs)
  for (const skillRef of normalized) {
    if (!options.allowWorkspace && skillRef.startsWith("workspace:")) {
      throw new AgentRegistryMutationError(
        "AGENT_INVALID_INPUT",
        `Workspace Skill ${skillRef} cannot be assigned to user agents until workspace trust is available`,
        400,
        {
          field: "allowedSkills",
          skillRef,
          reason: "workspace_skill_requires_trust",
        }
      )
    }
  }
  return normalized
}
```

Add `allowedSkills` in `createUserAgent`:

```ts
allowedSkills: this.normalizeAllowedSkills(input.allowedSkills),
```

Add `allowedSkills` in `updateUserAgent`:

```ts
allowedSkills: input.allowedSkills
  ? this.normalizeAllowedSkills(input.allowedSkills)
  : baseAgent.allowedSkills,
```

Add in `normalizeLoadedUserAgent`:

```ts
normalized.allowedSkills = this.normalizeAllowedSkills(normalized.allowedSkills)
```

- [ ] **Step 5: Return allowedSkills from detail API**

In `agent-runtime/src/routers/agents.ts`, add to `serializeAgentDetail`:

```ts
allowedSkills: agent.allowedSkills,
```

- [ ] **Step 6: Run tests**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test test/agent-skill-configuration.test.ts test/agent-crud.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit**

Run:

```powershell
git add agent-runtime/src/agents/types.ts agent-runtime/src/agents/agent-registry.ts agent-runtime/src/routers/agents.ts agent-runtime/test/agent-skill-configuration.test.ts
git commit -m "feat: add runtime agent skill selection"
```

Expected: commit succeeds.

## Task 3: Internal Skill Content Resolver

**Files:**
- Modify: `agent-runtime/src/runtime/capabilities.ts`
- Create: `agent-runtime/src/runtime/skill-content.ts`
- Modify: `agent-runtime/src/runtime/index.ts`
- Test: `agent-runtime/test/skill-content.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Create `agent-runtime/test/skill-content.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { CapabilityDiscoveryService } from "../src/runtime/capabilities"
import {
  SkillContentService,
  DEFAULT_MAX_SKILL_BODY_CHARS,
} from "../src/runtime/skill-content"

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true })
  await writeFile(path, content, "utf-8")
}

describe("SkillContentService", () => {
  test("reads a valid global Skill body without exposing absolute paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-skill-content-"))
    const homeDir = join(root, "home")
    const dataDir = join(root, "data")
    const skillPath = join(homeDir, ".agents", "skills", "review", "SKILL.md")
    await writeText(skillPath, [
      "---",
      "name: Review Skill",
      "description: Review instructions",
      "---",
      "",
      "# Review",
      "Always check tests.",
    ].join("\n"))

    const discovery = new CapabilityDiscoveryService({ homeDir, dataDir })
    const service = new SkillContentService(discovery)
    const result = await service.resolve({
      skillRefs: ["global:agents:review"],
    })

    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]).toMatchObject({
      ref: "global:agents:review",
      name: "Review Skill",
      source: "agents",
      level: "global",
      truncated: false,
    })
    expect(result.skills[0].body).toContain("Always check tests.")
    expect(JSON.stringify(result)).not.toContain(homeDir)
    expect(JSON.stringify(result)).not.toContain(skillPath)
  })

  test("skips invalid and missing Skill refs with warnings", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-skill-content-missing-"))
    const discovery = new CapabilityDiscoveryService({
      homeDir: join(root, "home"),
      dataDir: join(root, "data"),
    })
    const service = new SkillContentService(discovery)
    const result = await service.resolve({
      skillRefs: ["global:agents:missing"],
    })

    expect(result.skills).toEqual([])
    expect(result.warnings).toContain("Skill global:agents:missing was not found or is not valid.")
  })

  test("truncates long Skill bodies and parses relative refs", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-skill-content-long-"))
    const homeDir = join(root, "home")
    const dataDir = join(root, "data")
    const longBody = "x".repeat(DEFAULT_MAX_SKILL_BODY_CHARS + 500)
    await writeText(join(homeDir, ".codex", "skills", "long", "SKILL.md"), [
      "---",
      "name: Long Skill",
      "---",
      "",
      "[Guide](references/guide.md)",
      "```bash",
      "rm -rf ./tmp",
      "```",
      longBody,
    ].join("\n"))

    const discovery = new CapabilityDiscoveryService({ homeDir, dataDir })
    const service = new SkillContentService(discovery)
    const result = await service.resolve({
      skillRefs: ["global:codex:long"],
    })

    expect(result.skills[0].truncated).toBe(true)
    expect(result.skills[0].body.length).toBeLessThanOrEqual(DEFAULT_MAX_SKILL_BODY_CHARS)
    expect(result.skills[0].relativeRefs).toEqual(["references/guide.md"])
    expect(result.skills[0].warnings).toContain("Skill contains shell-like fenced code; Runtime treats it as text and does not execute it.")
  })
})
```

- [ ] **Step 2: Run failing resolver test**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test test/skill-content.test.ts
```

Expected: fail because `skill-content.ts` does not exist and `CapabilityDiscoveryService` lacks internal path resolution.

- [ ] **Step 3: Add internal file lookup to discovery service**

In `agent-runtime/src/runtime/capabilities.ts`, export an internal lookup type:

```ts
export type SkillCapabilityLookup = SkillCapabilitySummary & {
  filePath: string
}
```

Add method:

```ts
async listSkillLookups(input: CapabilityDiscoveryRequest = {}): Promise<SkillCapabilityLookup[]> {
  const request = CapabilityDiscoveryRequestSchema.parse(input)
  if ((request.scope === "workspace" || request.scope === "all") && !request.workspace) {
    throw new CapabilityDiscoveryError(
      "CAPABILITY_WORKSPACE_REQUIRED",
      "Workspace discovery requires an explicit workspace snapshot.",
    )
  }

  const roots: SkillRoot[] = []
  if (request.scope === "global" || request.scope === "all") {
    roots.push(...this.filterSkillRoots(this.globalSkillRoots(), request.sources))
  }
  if ((request.scope === "workspace" || request.scope === "all") && request.workspace) {
    roots.push(...this.filterSkillRoots(this.workspaceSkillRoots(request.workspace.rootPath), request.sources))
  }

  const lookups: SkillCapabilityLookup[] = []
  for (const root of roots) {
    lookups.push(...await this.discoverSkillLookups(root))
  }
  return sortById(lookups)
}
```

Add private helper:

```ts
private async discoverSkillLookups(root: SkillRoot): Promise<SkillCapabilityLookup[]> {
  if (!existsSync(root.directory)) return []
  let entries: StringDirent[]
  try {
    entries = await readdir(root.directory, { withFileTypes: true })
  } catch {
    return []
  }

  const items: SkillCapabilityLookup[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillFile = join(root.directory, entry.name, "SKILL.md")
    if (!existsSync(skillFile)) continue
    items.push({
      ...await this.readSkill(root, entry.name, skillFile),
      filePath: skillFile,
    })
  }
  return items
}
```

- [ ] **Step 4: Implement `SkillContentService`**

Create `agent-runtime/src/runtime/skill-content.ts`:

```ts
import { readFile } from "node:fs/promises"
import type {
  CapabilityDiscoveryRequest,
  CapabilityDiscoveryService,
  CapabilityLevel,
  CapabilitySource,
} from "./capabilities"

export const DEFAULT_MAX_SKILL_BODY_CHARS = 12_000
export const DEFAULT_MAX_TOTAL_SKILL_BODY_CHARS = 40_000
export const DEFAULT_MAX_SKILL_COUNT = 20

export type ResolvedSkillContent = {
  id: string
  ref: string
  name: string
  source: CapabilitySource
  level: CapabilityLevel
  body: string
  truncated: boolean
  contentChars: number
  relativeRefs: string[]
  warnings: string[]
}

export type SkillContentResolution = {
  skills: ResolvedSkillContent[]
  warnings: string[]
}

export type SkillContentResolveRequest = {
  skillRefs: string[]
  workspace?: CapabilityDiscoveryRequest["workspace"]
  maxSkillBodyChars?: number
  maxTotalBodyChars?: number
}

export class SkillContentService {
  constructor(private discoveryService: CapabilityDiscoveryService) {}

  async resolve(request: SkillContentResolveRequest): Promise<SkillContentResolution> {
    const skillRefs = normalizeSkillRefs(request.skillRefs).slice(0, DEFAULT_MAX_SKILL_COUNT)
    if (skillRefs.length === 0) return { skills: [], warnings: [] }

    const scope = skillRefs.some((ref) => ref.startsWith("workspace:")) ? "all" : "global"
    const lookups = await this.discoveryService.listSkillLookups({
      scope,
      workspace: request.workspace,
    })
    const lookupByRef = new Map<string, typeof lookups[number]>()
    for (const lookup of lookups) {
      lookupByRef.set(lookup.id, lookup)
      lookupByRef.set(lookup.path, lookup)
    }

    const warnings: string[] = []
    const skills: ResolvedSkillContent[] = []
    const maxSkillBodyChars = request.maxSkillBodyChars ?? DEFAULT_MAX_SKILL_BODY_CHARS
    const maxTotalBodyChars = request.maxTotalBodyChars ?? DEFAULT_MAX_TOTAL_SKILL_BODY_CHARS
    let remainingTotal = maxTotalBodyChars

    for (const skillRef of skillRefs) {
      const lookup = lookupByRef.get(skillRef)
      if (!lookup || !lookup.valid) {
        warnings.push(`Skill ${skillRef} was not found or is not valid.`)
        continue
      }
      if (remainingTotal <= 0) {
        warnings.push(`Skill ${skillRef} was skipped because the total Skill context limit was reached.`)
        continue
      }

      const raw = await readFile(lookup.filePath, "utf-8")
      const body = stripFrontmatter(raw).trim()
      const limit = Math.min(maxSkillBodyChars, remainingTotal)
      const truncated = body.length > limit
      const clipped = truncated ? body.slice(0, limit) : body
      remainingTotal -= clipped.length

      const skillWarnings = [
        ...(truncated ? ["Skill body was truncated."] : []),
        ...(containsShellFence(body)
          ? ["Skill contains shell-like fenced code; Runtime treats it as text and does not execute it."]
          : []),
      ]

      skills.push({
        id: lookup.id,
        ref: lookup.path,
        name: lookup.name,
        source: lookup.source,
        level: lookup.level,
        body: clipped,
        truncated,
        contentChars: clipped.length,
        relativeRefs: extractRelativeRefs(body),
        warnings: skillWarnings,
      })
    }

    return { skills, warnings }
  }
}

function normalizeSkillRefs(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
}

function containsShellFence(content: string): boolean {
  return /```(?:bash|sh|shell|zsh|powershell|pwsh|cmd|bat)\b/i.test(content)
}

function extractRelativeRefs(content: string): string[] {
  const refs = new Set<string>()
  const pattern = /\[[^\]]+\]\(([^)]+)\)/g
  for (const match of content.matchAll(pattern)) {
    const raw = (match[1] ?? "").trim()
    if (!raw || raw.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)) {
      continue
    }
    refs.add(raw.replace(/\\/g, "/"))
  }
  return Array.from(refs).sort()
}
```

- [ ] **Step 5: Export resolver**

In `agent-runtime/src/runtime/index.ts`, export:

```ts
export {
  SkillContentService,
  DEFAULT_MAX_SKILL_BODY_CHARS,
  DEFAULT_MAX_TOTAL_SKILL_BODY_CHARS,
  DEFAULT_MAX_SKILL_COUNT,
}
export type { ResolvedSkillContent, SkillContentResolution, SkillContentResolveRequest }
  from "./skill-content"
```

- [ ] **Step 6: Run resolver tests**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test test/skill-content.test.ts test/capability-discovery.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit**

Run:

```powershell
git add agent-runtime/src/runtime/capabilities.ts agent-runtime/src/runtime/skill-content.ts agent-runtime/src/runtime/index.ts agent-runtime/test/skill-content.test.ts
git commit -m "feat: resolve skill bodies for runtime prompts"
```

Expected: commit succeeds.

## Task 4: Prompt Formatting

**Files:**
- Create: `agent-runtime/src/runtime/skill-prompt.ts`
- Modify: `agent-runtime/src/runtime/types.ts`
- Modify: `agent-runtime/src/runtime/ai-sdk-executor.ts`
- Modify: `agent-runtime/src/runtime/orchestrator-executor.ts`
- Test: `agent-runtime/test/skill-prompt.test.ts`
- Test: `agent-runtime/test/pinned-messages.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Create `agent-runtime/test/skill-prompt.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { buildSystemPrompt } from "../src/runtime/ai-sdk-executor"
import { formatInjectedSkillsForPrompt } from "../src/runtime/skill-prompt"
import type { AgentExecutionContext, ResolvedSkillContent } from "../src/runtime"

const skill: ResolvedSkillContent = {
  id: "global:agents:review",
  ref: "global:agents:review",
  name: "Review Skill",
  source: "agents",
  level: "global",
  body: "Always inspect tests before claiming completion.",
  truncated: false,
  contentChars: 48,
  relativeRefs: [],
  warnings: [],
}

describe("skill prompt formatting", () => {
  test("formats injected Skills as a bounded instruction block", () => {
    const block = formatInjectedSkillsForPrompt([skill])

    expect(block).toContain("<AgentHubSkillInstructions>")
    expect(block).toContain('id="global:agents:review"')
    expect(block).toContain("Always inspect tests before claiming completion.")
    expect(block).toContain("</AgentHubSkillInstructions>")
  })

  test("injects Skills into AI SDK system prompt", () => {
    const context = {
      runId: "run_skill_prompt",
      input: {
        conversationId: "conv_skill_prompt",
        mode: "single",
        participantAgentIds: ["coder"],
        addressedAgentIds: [],
        userMessage: { role: "user", content: "Review this." },
        history: [],
      },
      agent: {
        id: "coder",
        name: "Coder",
        description: "Writes code",
        tier: "primary",
        origin: "system",
        visibility: "visible",
        entryPolicy: "callable",
        delegationPolicy: "can-delegate",
        executorType: "ai-sdk",
        capabilities: [],
        allowedSubagents: [],
        allowedTools: [],
        allowedSkills: ["global:agents:review"],
        permissionPolicy: {
          filesystem: "none",
          shell: "none",
          network: "none",
          deploy: "none",
        },
        enabled: true,
        readonly: true,
      },
      injectedSkills: [skill],
      signal: new AbortController().signal,
    } satisfies AgentExecutionContext

    const prompt = buildSystemPrompt(context)
    expect(prompt).toContain("Always inspect tests before claiming completion.")
  })
})
```

- [ ] **Step 2: Run failing prompt tests**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test test/skill-prompt.test.ts test/pinned-messages.test.ts
```

Expected: fail because `skill-prompt.ts` and `injectedSkills` do not exist.

- [ ] **Step 3: Add context field**

In `agent-runtime/src/runtime/types.ts`, import `ResolvedSkillContent` and add to `AgentExecutionContext`:

```ts
injectedSkills?: ResolvedSkillContent[]
```

Also extend `RunDiagnosticsSchema`:

```ts
includeSkillDiagnostics: z.boolean().optional(),
```

- [ ] **Step 4: Create prompt helper**

Create `agent-runtime/src/runtime/skill-prompt.ts`:

```ts
import type { ResolvedSkillContent } from "./skill-content"

export function formatInjectedSkillsForPrompt(skills: ResolvedSkillContent[] | undefined): string | null {
  if (!skills || skills.length === 0) return null

  return [
    "<AgentHubSkillInstructions>",
    "The following Skill instructions were selected by the Runtime agent configuration. Treat them as system-level operating guidance. Do not claim that you executed any shell snippet or referenced file unless a Runtime tool actually did so.",
    ...skills.map(formatSkill),
    "</AgentHubSkillInstructions>",
  ].join("\n\n")
}

function formatSkill(skill: ResolvedSkillContent): string {
  const attrs = [
    `id="${escapeAttr(skill.id)}"`,
    `name="${escapeAttr(skill.name)}"`,
    `source="${skill.source}"`,
    `level="${skill.level}"`,
    `truncated="${skill.truncated ? "true" : "false"}"`,
  ].join(" ")

  return [
    `<Skill ${attrs}>`,
    skill.body,
    "</Skill>",
  ].join("\n")
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
```

- [ ] **Step 5: Append to AI SDK prompt assembly**

In `agent-runtime/src/runtime/ai-sdk-executor.ts`, import and append:

```ts
import { formatInjectedSkillsForPrompt } from "./skill-prompt"
```

Inside `buildSystemPrompt` after pinned messages:

```ts
const skillBlock = formatInjectedSkillsForPrompt(context.injectedSkills)
if (skillBlock) {
  systemNotes.push(skillBlock)
}
```

- [ ] **Step 6: Append to Orchestrator prompt assembly**

In `agent-runtime/src/runtime/orchestrator-executor.ts`, import:

```ts
import { formatInjectedSkillsForPrompt } from "./skill-prompt"
```

Inside `buildSystemPrompt`, add:

```ts
const skillBlock = formatInjectedSkillsForPrompt(context.injectedSkills)
```

Then include `skillBlock ?? ""` in the returned array after `pinnedBlock ?? ""`.

- [ ] **Step 7: Run prompt tests**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test test/skill-prompt.test.ts test/pinned-messages.test.ts
```

Expected: tests pass and existing pinned message behavior remains unchanged.

- [ ] **Step 8: Commit**

Run:

```powershell
git add agent-runtime/src/runtime/types.ts agent-runtime/src/runtime/skill-prompt.ts agent-runtime/src/runtime/ai-sdk-executor.ts agent-runtime/src/runtime/orchestrator-executor.ts agent-runtime/test/skill-prompt.test.ts agent-runtime/test/pinned-messages.test.ts
git commit -m "feat: format injected skills in runtime prompts"
```

Expected: commit succeeds.

## Task 5: RunManager Skill Resolution And Diagnostics

**Files:**
- Modify: `agent-runtime/src/runtime/types.ts`
- Modify: `agent-runtime/src/runtime/run-manager.ts`
- Modify: `agent-runtime/src/runtime/index.ts`
- Modify: `agent-runtime/src/index.ts`
- Test: `agent-runtime/test/skill-prompt.test.ts`

- [ ] **Step 1: Add diagnostic event type**

In `agent-runtime/src/runtime/types.ts`, add `"agent.skill_context.resolved"` to `RunEventTypeSchema`:

```ts
"agent.skill_context.resolved",
```

- [ ] **Step 2: Add RunManager constructor dependency**

In `agent-runtime/src/runtime/run-manager.ts`, import:

```ts
import type { SkillContentService, SkillContentResolution } from "./skill-content"
```

Add optional constructor parameter at the end:

```ts
private skillContentService?: SkillContentService
```

Keep all existing parameters in their current order and append the new one after `systemModelSettingsService`.

- [ ] **Step 3: Resolve Skills before building execution context**

In `executeAgentExecution`, before `const context: AgentExecutionContext = { ... }`, add:

```ts
const skillResolution = await this.resolveSkillContext(run, agent)
```

Add to context:

```ts
injectedSkills: skillResolution.skills,
```

- [ ] **Step 4: Emit optional metadata-only diagnostics**

After context creation and before `executor.execute(context)`, add:

```ts
if (run.input.diagnostics?.includeSkillDiagnostics && agent.allowedSkills.length > 0) {
  emitExecutionEvent(createRunEvent(run.id, "agent.skill_context.resolved", agent.id, {
    status: skillResolution.skills.length === agent.allowedSkills.length
      ? "resolved"
      : skillResolution.skills.length > 0
        ? "partial"
        : "skipped",
    skills: skillResolution.skills.map((skill) => ({
      id: skill.id,
      ref: skill.ref,
      name: skill.name,
      source: skill.source,
      level: skill.level,
      truncated: skill.truncated,
      contentChars: skill.contentChars,
      relativeRefs: skill.relativeRefs,
      warnings: skill.warnings,
    })),
    warnings: skillResolution.warnings,
  }))
}
```

- [ ] **Step 5: Add resolver helper**

Add a private method to `RunManager`:

```ts
private async resolveSkillContext(run: RunRecord, agent: AgentDefinition): Promise<SkillContentResolution> {
  if (!this.skillContentService || agent.allowedSkills.length === 0) {
    return { skills: [], warnings: [] }
  }

  const skillRefs = agent.origin === "user"
    ? agent.allowedSkills.filter((ref) => ref.startsWith("global:"))
    : agent.allowedSkills

  if (skillRefs.length === 0) {
    return {
      skills: [],
      warnings: ["No Skill refs are injectable for this agent in the current trust policy."],
    }
  }

  try {
    return await this.skillContentService.resolve({
      skillRefs,
      workspace: run.input.workspace,
    })
  } catch (error) {
    return {
      skills: [],
      warnings: [
        `Skill context resolution failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    }
  }
}
```

- [ ] **Step 6: Wire service in runtime entrypoint**

In `agent-runtime/src/index.ts`, construct capability service before RunManager:

```ts
const capabilityDiscoveryService = new CapabilityDiscoveryService({ dataDir: config.dataDir })
const skillContentService = new SkillContentService(capabilityDiscoveryService)
```

Pass to RunManager:

```ts
const runManager = new RunManager(
  agentRegistry,
  providerService,
  undefined,
  toolRegistry,
  undefined,
  systemModelSettingsService,
  skillContentService
)
```

Import `SkillContentService` from `./runtime`.

- [ ] **Step 7: Export types**

In `agent-runtime/src/runtime/index.ts`, export `ResolvedSkillContent` and `SkillContentResolution`.

- [ ] **Step 8: Run focused checks**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bunx tsc --noEmit
bun test test/skill-content.test.ts test/skill-prompt.test.ts test/runtime-runs-sse.test.ts
```

Expected: typecheck and selected tests pass.

- [ ] **Step 9: Commit**

Run:

```powershell
git add agent-runtime/src/runtime/types.ts agent-runtime/src/runtime/run-manager.ts agent-runtime/src/runtime/index.ts agent-runtime/src/index.ts
git commit -m "feat: resolve allowed skills for runtime runs"
```

Expected: commit succeeds.

## Task 6: Keep Instruct And External Agents Unchanged

**Files:**
- Modify only if tests reveal schema fallout:
  - `agent-runtime/src/instruct-runtime/tools/save-agent-tool.ts`
  - `agent-runtime/src/instruct-runtime/types.ts`
  - `agent-runtime/test/instruct-save-agent-tool.test.ts`
  - `agent-runtime/test/instruct-agent-definition.test.ts`

- [ ] **Step 1: Run current instruct tests**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test test/instruct-agent-definition.test.ts test/instruct-save-agent-tool.test.ts test/instruct-run-manager.test.ts
```

Expected: pass. If they fail because `AgentDefinitionSchema` now defaults `allowedSkills`, update expected objects to include `allowedSkills: []`.

- [ ] **Step 2: Preserve save_agent input**

Do not add `allowedSkills` to the Instruct `save_agent` tool in Phase 4A. The Instruct Agent should not author Skill injection until the product trust flow exists.

- [ ] **Step 3: Verify external adapters**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test test/external-adapter.test.ts test/opencode-real-client.test.ts test/claude-code-real-client.test.ts test/codex-real-client.test.ts
```

Expected: pass or preserve existing skips. External `executorType = "external-adapter"` agents should ignore `allowedSkills` during execution.

- [ ] **Step 4: Commit test compatibility changes if needed**

If Step 1 required expected-object updates, run:

```powershell
git add agent-runtime/src/instruct-runtime agent-runtime/test/instruct-agent-definition.test.ts agent-runtime/test/instruct-save-agent-tool.test.ts
git commit -m "test: align instruct agents with skill defaults"
```

Expected: commit succeeds only if files changed.

## Task 7: Full Runtime Verification

**Files:**
- No source edits unless verification exposes a defect.

- [ ] **Step 1: Typecheck Runtime**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bunx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 2: Run Runtime test suite**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test
```

Expected: exits 0, with existing skips unchanged.

- [ ] **Step 3: Security scan of changed response surfaces**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub
Get-ChildItem -Path agent-runtime/src,agent-runtime/test -Recurse -File | Select-String -Pattern 'allowedSkills|skill_context|SkillContent|SkillInstructions' | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" }
```

Expected:
- Skill bodies appear only in prompt helper/tests.
- Diagnostic event data maps only metadata fields and never includes `body`.
- Discovery responses still do not include absolute file paths.

- [ ] **Step 4: Commit final fixes if needed**

If Step 1 or Step 2 exposes issues, fix them, rerun affected checks, and commit:

```powershell
git add agent-runtime docs
git commit -m "fix: stabilize runtime skill injection"
```

Expected: commit succeeds only if files changed.

## Task 8: Final Integration Notes

**Files:**
- Modify: `docs/roadmap/skill-mcp-capability-discovery.md`

- [ ] **Step 1: Mark Phase 4A progress**

Add to roadmap current progress:

```markdown
- 2026-06-07：Phase 4A Runtime-only global Skill 注入完成；workspace Skill 注入等待 trust contract 和前端确认流。
```

- [ ] **Step 2: Commit roadmap progress**

Run:

```powershell
git add docs/roadmap/skill-mcp-capability-discovery.md
git commit -m "docs: record runtime skill injection progress"
```

Expected: commit succeeds.

- [ ] **Step 3: Push main**

Run:

```powershell
git status --short
git push origin main
```

Expected: `git status --short` is empty before push, and `origin/main` receives the new commits.

## Acceptance Criteria

- `AgentDefinitionSchema` and Runtime agent detail responses include `allowedSkills: string[]`.
- User agent create/update accepts deduped global Skill refs and rejects workspace Skill refs with stable `AGENT_INVALID_INPUT`.
- Runtime can resolve selected valid Skill bodies from existing discovery roots through an internal-only service.
- AI SDK and Orchestrator system prompts include selected Skill bodies when `context.injectedSkills` is populated.
- Skill body content is never returned by capability discovery APIs, agent APIs, normal `message.*` events, or `agent.skill_context.resolved` diagnostics.
- Invalid, missing, unreadable, or over-limit Skills degrade to warnings and do not fail the whole Run.
- Instruct Agent and external adapters do not gain Skill injection behavior in this phase.
- `bunx tsc --noEmit` and `bun test` pass in `agent-runtime`.

## Self-Review

- Spec coverage: Covers schema, persistence, prompt injection, diagnostics, docs, security limits, and Runtime-only boundaries.
- Placeholder scan: No unresolved placeholders or unspecified implementation slots remain.
- Type consistency: `allowedSkills`, `ResolvedSkillContent`, `SkillContentService`, `formatInjectedSkillsForPrompt`, and `agent.skill_context.resolved` are used consistently across tasks.
- Deliberate gap: Workspace Skill injection for user agents is intentionally blocked until a workspace trust contract exists.
