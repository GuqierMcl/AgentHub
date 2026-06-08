# Runtime Workspace Skill Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Runtime-only trust contract that lets workspace Skill refs remain discoverable and configurable, but only injects workspace Skill bodies after the bound workspace and Skill ref have an explicit trust record.

**Architecture:** Keep the browser and HubServer out of this implementation batch. Agent Runtime will own a small persistent trust store under `config.dataDir`, expose internal Runtime APIs for HubServer to query/record trust decisions later, and have `RunManager` enforce trust before passing workspace Skill refs to `SkillContentService`. Global Skill injection keeps the current Phase 4A behavior.

**Tech Stack:** TypeScript, Bun, Hono, Zod, existing Agent Runtime `CapabilityDiscoveryService`, `SkillContentService`, `RunManager`, and Bun test.

---

## Hard Rules For This Plan

- Do **not** run `git add`, `git commit`, `git push`, `git filter-branch`, or any other history-changing Git command while implementing this plan.
- At the end of each task, stop at `git status --short` so the user can review and commit manually.
- Do not modify `web/` or `hub-server/` in this phase.
- Do not execute Skill shell snippets, do not start MCP servers, do not call MCP tools, and do not expand Skill relative references.
- Do not expose Skill body text, workspace root absolute paths, raw root hashes plus path inputs, tokens, headers, env values, or file system paths in Runtime API responses or Run diagnostics.
- Keep workspace Skill trust separate from workspace file permissions; this trust only controls prompt injection eligibility for discovered workspace Skills.

## Files

- Modify: `D:/PyWorkSpace/AgentHub/docs/architecture/AGENT_RUNTIME.md`
- Modify: `D:/PyWorkSpace/AgentHub/docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`
- Modify: `D:/PyWorkSpace/AgentHub/docs/roadmap/skill-mcp-capability-discovery.md`
- Create: `D:/PyWorkSpace/AgentHub/agent-runtime/src/runtime/workspace-skill-trust.ts`
- Modify: `D:/PyWorkSpace/AgentHub/agent-runtime/src/runtime/index.ts`
- Modify: `D:/PyWorkSpace/AgentHub/agent-runtime/src/runtime/run-manager.ts`
- Modify: `D:/PyWorkSpace/AgentHub/agent-runtime/src/index.ts`
- Create: `D:/PyWorkSpace/AgentHub/agent-runtime/src/routers/workspace-skill-trust.ts`
- Modify: `D:/PyWorkSpace/AgentHub/agent-runtime/src/routers/index.ts`
- Modify: `D:/PyWorkSpace/AgentHub/agent-runtime/src/agents/agent-registry.ts`
- Modify: `D:/PyWorkSpace/AgentHub/agent-runtime/test/agent-skill-configuration.test.ts`
- Create: `D:/PyWorkSpace/AgentHub/agent-runtime/test/workspace-skill-trust.test.ts`
- Create: `D:/PyWorkSpace/AgentHub/agent-runtime/test/workspace-skill-trust-router.test.ts`
- Modify: `D:/PyWorkSpace/AgentHub/agent-runtime/test/run-manager-skill-injection.test.ts`

## Task 1: Document The Phase 4B Boundary

**Files:**
- Modify: `docs/architecture/AGENT_RUNTIME.md`
- Modify: `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`
- Modify: `docs/roadmap/skill-mcp-capability-discovery.md`

- [ ] **Step 1: Update Runtime architecture doc**

Add this subsection immediately after the existing `#### Phase 4A Skill 注入边界` section in `docs/architecture/AGENT_RUNTIME.md`:

```markdown
#### Phase 4B Workspace Skill Trust 边界

Runtime 可以保存 workspace Skill trust record，用于判断某个绑定 workspace 中的 `workspace:*` Skill ref 是否允许进入内部 AI SDK / Orchestrator prompt assembly。trust record 只保存 `workspaceId`、workspace root hash、Skill ref、trust 状态和时间戳；不得在 API 响应或持久化记录中保存或返回 workspace root 绝对路径。

`workspace:*` Skill ref 可以出现在用户自定义智能体配置中，但在 Run 未绑定 workspace、workspace root hash 不匹配、trust record 不存在或已撤销时，Runtime 必须跳过正文注入，并仅在 `agent.skill_context.resolved` 诊断事件中返回 metadata-only warning。global Skill 注入保持 Phase 4A 行为。

本阶段仍不执行 Skill、不启动 MCP server、不读取 Skill 引用文件、不把 Skill 正文返回给 HubServer 或前端，也不实现 Web 确认 UI。HubServer 后续负责把前端确认结果转发给 Runtime trust API。
```

- [ ] **Step 2: Update Runtime API contract**

In `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`, add this section after the Runtime Skill / MCP Capability Discovery section:

```markdown
### Runtime Workspace Skill Trust

Workspace Skill Trust 是 Runtime 内部 API，用于记录 HubServer 后续从产品确认流转发来的 workspace Skill 信任决策。浏览器不得直接调用这些端点，也不得直接传 workspace root 给 Runtime。

```ts
type WorkspaceSkillTrustWorkspace = {
  workspaceId: string
  backendType: "local"
  rootPath: string
}

type WorkspaceSkillTrustRecord = {
  workspaceId: string
  backendType: "local"
  workspaceRootHash: string
  skillRef: string // must start with workspace:
  source: "agents" | "codex" | "claude-code" | "opencode"
  trusted: boolean
  status: "trusted" | "untrusted"
  trustedAt?: string
  revokedAt?: string
  createdAt: string
  updatedAt: string
}
```

**端点**：`POST /runtime/workspace-skill-trust/query`

请求体：

```ts
{
  workspace: WorkspaceSkillTrustWorkspace
  skillRefs?: string[]
}
```

成功响应：

```ts
{
  checkedAt: string
  workspace: {
    workspaceId: string
    backendType: "local"
    workspaceRootHash: string
  }
  trusts: WorkspaceSkillTrustRecord[]
}
```

`skillRefs` 为空时返回该 workspace root hash 下已保存的 trust records；传入 `skillRefs` 时必须只包含 `workspace:*` Skill refs，未保存的 ref 以 `trusted = false` / `status = "untrusted"` 返回。

**端点**：`PUT /runtime/workspace-skill-trust`

请求体：

```ts
{
  workspace: WorkspaceSkillTrustWorkspace
  skillRef: string
  trusted: boolean
  reason?: string
}
```

成功响应：

```ts
{
  record: WorkspaceSkillTrustRecord
}
```

错误码：

| 错误码 | HTTP Status | 说明 |
| --- | --- | --- |
| `WORKSPACE_SKILL_TRUST_INVALID_INPUT` | 400 | 请求体格式非法 |
| `WORKSPACE_SKILL_TRUST_REF_INVALID` | 400 | `skillRef` 不是合法 `workspace:*` Skill ref |

响应和错误不得返回 `rootPath`、Skill body、真实文件路径、headers、env 或 secret。
```

Also update the `AgentDefinition` contract note to state:

```markdown
`allowedSkills` can contain `global:*` and `workspace:*` refs. Runtime injects `global:*` refs directly, but injects `workspace:*` refs only when the current Run has a bound workspace and the Workspace Skill Trust service reports the exact `{ workspaceId, rootPath hash, skillRef }` as trusted.
```

- [ ] **Step 3: Update roadmap progress**

In `docs/roadmap/skill-mcp-capability-discovery.md`, under Phase 4 add:

```markdown
- Phase 4B 增加 Runtime-only workspace Skill trust contract：允许配置 `workspace:*` refs，但注入前必须校验 workspace root hash 与 Skill ref 的 trust record。
```

In `## 当前进度`, add:

```markdown
- 2026-06-07：Phase 4B 进入计划阶段，目标是 Runtime-only workspace Skill trust contract；不包含 Web UI 或 HubServer 代理实现。
```

- [ ] **Step 4: Verify docs text exists**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub
Select-String -Path docs\architecture\AGENT_RUNTIME.md,docs\contracts\AGENT_RUNTIME_API_CONTRACTS.md,docs\roadmap\skill-mcp-capability-discovery.md -Pattern 'Phase 4B|Workspace Skill Trust|workspace Skill trust'
```

Expected: matches appear in all three docs.

- [ ] **Step 5: Review checkpoint, no Git commit**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub
git status --short
```

Expected: only the three docs are modified. Do not stage or commit.

## Task 2: Workspace Skill Trust Service

**Files:**
- Create: `agent-runtime/src/runtime/workspace-skill-trust.ts`
- Modify: `agent-runtime/src/runtime/index.ts`
- Test: `agent-runtime/test/workspace-skill-trust.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `agent-runtime/test/workspace-skill-trust.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  WorkspaceSkillTrustService,
  type WorkspaceSkillTrustWorkspace,
} from "../src/runtime"

async function createService(): Promise<{
  service: WorkspaceSkillTrustService
  dataDir: string
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-skill-trust-"))
  const service = new WorkspaceSkillTrustService({ dataDir })
  await service.initialize()
  return { service, dataDir }
}

const workspace: WorkspaceSkillTrustWorkspace = {
  workspaceId: "workspace_alpha",
  backendType: "local",
  rootPath: "D:\\Projects\\Alpha",
}

describe("WorkspaceSkillTrustService", () => {
  test("returns untrusted records without exposing workspace root paths", async () => {
    const { service } = await createService()

    const result = await service.list({
      workspace,
      skillRefs: ["workspace:agents:review"],
    })

    expect(result.trusts).toHaveLength(1)
    expect(result.trusts[0]).toMatchObject({
      workspaceId: "workspace_alpha",
      backendType: "local",
      skillRef: "workspace:agents:review",
      source: "agents",
      trusted: false,
      status: "untrusted",
    })
    expect(result.workspace.workspaceRootHash).toHaveLength(64)
    expect(JSON.stringify(result)).not.toContain("D:\\Projects\\Alpha")
  })

  test("persists trusted and revoked workspace Skill decisions", async () => {
    const { service, dataDir } = await createService()

    const trusted = await service.decide({
      workspace,
      skillRef: "workspace:codex:review",
      trusted: true,
      reason: "user-approved",
    })

    expect(trusted.record).toMatchObject({
      skillRef: "workspace:codex:review",
      source: "codex",
      trusted: true,
      status: "trusted",
    })
    expect(await service.isTrusted({
      workspace,
      skillRef: "workspace:codex:review",
    })).toBe(true)

    const reloaded = new WorkspaceSkillTrustService({ dataDir })
    await reloaded.initialize()
    expect(await reloaded.isTrusted({
      workspace,
      skillRef: "workspace:codex:review",
    })).toBe(true)

    const revoked = await reloaded.decide({
      workspace,
      skillRef: "workspace:codex:review",
      trusted: false,
      reason: "user-revoked",
    })

    expect(revoked.record).toMatchObject({
      trusted: false,
      status: "untrusted",
    })
    expect(revoked.record.revokedAt).toBeDefined()
    expect(await reloaded.isTrusted({
      workspace,
      skillRef: "workspace:codex:review",
    })).toBe(false)

    const raw = await readFile(join(dataDir, "workspace-skill-trust.json"), "utf-8")
    expect(raw).not.toContain("D:\\Projects\\Alpha")
  })

  test("invalidates trust when the workspace root hash changes", async () => {
    const { service } = await createService()

    await service.decide({
      workspace,
      skillRef: "workspace:agents:review",
      trusted: true,
    })

    expect(await service.isTrusted({
      workspace: {
        ...workspace,
        rootPath: "D:\\Projects\\Different",
      },
      skillRef: "workspace:agents:review",
    })).toBe(false)
  })

  test("rejects global or malformed Skill refs", async () => {
    const { service } = await createService()

    await expect(service.decide({
      workspace,
      skillRef: "global:agents:review",
      trusted: true,
    })).rejects.toMatchObject({
      code: "WORKSPACE_SKILL_TRUST_REF_INVALID",
    })

    await expect(service.list({
      workspace,
      skillRefs: ["workspace:unknown:review"],
    })).rejects.toMatchObject({
      code: "WORKSPACE_SKILL_TRUST_REF_INVALID",
    })
  })
})
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test test/workspace-skill-trust.test.ts
```

Expected: fails because `WorkspaceSkillTrustService` is not implemented/exported.

- [ ] **Step 3: Implement trust service**

Create `agent-runtime/src/runtime/workspace-skill-trust.ts`:

```ts
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"

const WorkspaceSkillTrustSourceSchema = z.enum(["agents", "codex", "claude-code", "opencode"])
const WorkspaceSkillRefSchema = z.string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^workspace:(agents|codex|claude-code|opencode):[A-Za-z0-9._:-]+$/)

export const WorkspaceSkillTrustWorkspaceSchema = z.object({
  workspaceId: z.string().trim().min(1),
  backendType: z.literal("local"),
  rootPath: z.string().trim().min(1),
}).strict()
export type WorkspaceSkillTrustWorkspace = z.infer<typeof WorkspaceSkillTrustWorkspaceSchema>

export const WorkspaceSkillTrustListRequestSchema = z.object({
  workspace: WorkspaceSkillTrustWorkspaceSchema,
  skillRefs: z.array(WorkspaceSkillRefSchema).optional(),
}).strict()
export type WorkspaceSkillTrustListRequest = z.infer<typeof WorkspaceSkillTrustListRequestSchema>

export const WorkspaceSkillTrustDecisionRequestSchema = z.object({
  workspace: WorkspaceSkillTrustWorkspaceSchema,
  skillRef: WorkspaceSkillRefSchema,
  trusted: z.boolean(),
  reason: z.string().trim().max(500).optional(),
}).strict()
export type WorkspaceSkillTrustDecisionRequest = z.infer<typeof WorkspaceSkillTrustDecisionRequestSchema>

export type WorkspaceSkillTrustStatus = "trusted" | "untrusted"

export type WorkspaceSkillTrustRecord = {
  workspaceId: string
  backendType: "local"
  workspaceRootHash: string
  skillRef: string
  source: z.infer<typeof WorkspaceSkillTrustSourceSchema>
  trusted: boolean
  status: WorkspaceSkillTrustStatus
  trustedAt?: string
  revokedAt?: string
  createdAt: string
  updatedAt: string
}

export type WorkspaceSkillTrustListResponse = {
  checkedAt: string
  workspace: {
    workspaceId: string
    backendType: "local"
    workspaceRootHash: string
  }
  trusts: WorkspaceSkillTrustRecord[]
}

export type WorkspaceSkillTrustDecisionResponse = {
  record: WorkspaceSkillTrustRecord
}

type StoredWorkspaceSkillTrustFile = {
  version: 1
  records: WorkspaceSkillTrustRecord[]
}

export class WorkspaceSkillTrustError extends Error {
  constructor(
    public code:
      | "WORKSPACE_SKILL_TRUST_INVALID_INPUT"
      | "WORKSPACE_SKILL_TRUST_REF_INVALID"
      | "WORKSPACE_SKILL_TRUST_STORE_FAILED",
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message)
    this.name = "WorkspaceSkillTrustError"
  }
}

export type WorkspaceSkillTrustServiceOptions = {
  dataDir: string
  filePath?: string
}

export class WorkspaceSkillTrustService {
  private filePath: string
  private records = new Map<string, WorkspaceSkillTrustRecord>()
  private initialized = false

  constructor(options: WorkspaceSkillTrustServiceOptions) {
    this.filePath = options.filePath ?? join(options.dataDir, "workspace-skill-trust.json")
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    try {
      const raw = await readFile(this.filePath, "utf-8")
      const parsed = JSON.parse(raw) as StoredWorkspaceSkillTrustFile
      if (parsed.version === 1 && Array.isArray(parsed.records)) {
        for (const record of parsed.records) {
          const key = createTrustKey(record.workspaceId, record.workspaceRootHash, record.skillRef)
          this.records.set(key, record)
        }
      }
    } catch {
      this.records.clear()
    }
    this.initialized = true
  }

  async list(input: WorkspaceSkillTrustListRequest): Promise<WorkspaceSkillTrustListResponse> {
    await this.initialize()
    const request = parseListRequest(input)
    const workspaceRootHash = hashWorkspaceRoot(request.workspace.rootPath)

    const trusts = request.skillRefs?.length
      ? request.skillRefs.map((skillRef) =>
          this.records.get(createTrustKey(request.workspace.workspaceId, workspaceRootHash, skillRef)) ??
          createUntrustedRecord(request.workspace, workspaceRootHash, skillRef)
        )
      : Array.from(this.records.values())
          .filter((record) =>
            record.workspaceId === request.workspace.workspaceId &&
            record.workspaceRootHash === workspaceRootHash
          )
          .sort((left, right) => left.skillRef.localeCompare(right.skillRef))

    return {
      checkedAt: new Date().toISOString(),
      workspace: {
        workspaceId: request.workspace.workspaceId,
        backendType: "local",
        workspaceRootHash,
      },
      trusts,
    }
  }

  async decide(input: WorkspaceSkillTrustDecisionRequest): Promise<WorkspaceSkillTrustDecisionResponse> {
    await this.initialize()
    const request = parseDecisionRequest(input)
    const workspaceRootHash = hashWorkspaceRoot(request.workspace.rootPath)
    const key = createTrustKey(request.workspace.workspaceId, workspaceRootHash, request.skillRef)
    const existing = this.records.get(key)
    const now = new Date().toISOString()
    const record: WorkspaceSkillTrustRecord = {
      ...(existing ?? createUntrustedRecord(request.workspace, workspaceRootHash, request.skillRef, now)),
      trusted: request.trusted,
      status: request.trusted ? "trusted" : "untrusted",
      trustedAt: request.trusted ? now : existing?.trustedAt,
      revokedAt: request.trusted ? undefined : now,
      updatedAt: now,
    }

    this.records.set(key, record)
    await this.save()
    return { record }
  }

  async isTrusted(input: {
    workspace: WorkspaceSkillTrustWorkspace
    skillRef: string
  }): Promise<boolean> {
    await this.initialize()
    const workspace = WorkspaceSkillTrustWorkspaceSchema.parse(input.workspace)
    const skillRef = parseWorkspaceSkillRef(input.skillRef)
    const workspaceRootHash = hashWorkspaceRoot(workspace.rootPath)
    const record = this.records.get(createTrustKey(workspace.workspaceId, workspaceRootHash, skillRef))
    return record?.trusted === true
  }

  private async save(): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      const payload: StoredWorkspaceSkillTrustFile = {
        version: 1,
        records: Array.from(this.records.values())
          .sort((left, right) => createTrustKey(left.workspaceId, left.workspaceRootHash, left.skillRef)
            .localeCompare(createTrustKey(right.workspaceId, right.workspaceRootHash, right.skillRef))),
      }
      await writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
    } catch {
      throw new WorkspaceSkillTrustError(
        "WORKSPACE_SKILL_TRUST_STORE_FAILED",
        "Workspace Skill trust store could not be saved.",
        500,
      )
    }
  }
}

function parseListRequest(input: WorkspaceSkillTrustListRequest): WorkspaceSkillTrustListRequest {
  const parsed = WorkspaceSkillTrustListRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new WorkspaceSkillTrustError(
      "WORKSPACE_SKILL_TRUST_INVALID_INPUT",
      "Invalid workspace Skill trust query.",
      400,
      parsed.error.issues,
    )
  }
  for (const skillRef of parsed.data.skillRefs ?? []) {
    parseWorkspaceSkillRef(skillRef)
  }
  return parsed.data
}

function parseDecisionRequest(input: WorkspaceSkillTrustDecisionRequest): WorkspaceSkillTrustDecisionRequest {
  const parsed = WorkspaceSkillTrustDecisionRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new WorkspaceSkillTrustError(
      "WORKSPACE_SKILL_TRUST_INVALID_INPUT",
      "Invalid workspace Skill trust decision.",
      400,
      parsed.error.issues,
    )
  }
  parseWorkspaceSkillRef(parsed.data.skillRef)
  return parsed.data
}

function parseWorkspaceSkillRef(skillRef: string): string {
  const parsed = WorkspaceSkillRefSchema.safeParse(skillRef)
  if (!parsed.success) {
    throw new WorkspaceSkillTrustError(
      "WORKSPACE_SKILL_TRUST_REF_INVALID",
      "Workspace Skill trust only accepts workspace:* Skill refs.",
      400,
      parsed.error.issues,
    )
  }
  return parsed.data
}

function createUntrustedRecord(
  workspace: WorkspaceSkillTrustWorkspace,
  workspaceRootHash: string,
  skillRef: string,
  timestamp = new Date().toISOString(),
): WorkspaceSkillTrustRecord {
  return {
    workspaceId: workspace.workspaceId,
    backendType: "local",
    workspaceRootHash,
    skillRef,
    source: extractWorkspaceSkillSource(skillRef),
    trusted: false,
    status: "untrusted",
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function extractWorkspaceSkillSource(skillRef: string): WorkspaceSkillTrustRecord["source"] {
  const source = skillRef.split(":")[1]
  return WorkspaceSkillTrustSourceSchema.parse(source)
}

function createTrustKey(workspaceId: string, workspaceRootHash: string, skillRef: string): string {
  return `${workspaceId}:${workspaceRootHash}:${skillRef}`
}

export function hashWorkspaceRoot(rootPath: string): string {
  return createHash("sha256").update(rootPath.trim()).digest("hex")
}
```

- [ ] **Step 4: Export trust service**

In `agent-runtime/src/runtime/index.ts`, add:

```ts
export {
  WorkspaceSkillTrustDecisionRequestSchema,
  WorkspaceSkillTrustError,
  WorkspaceSkillTrustListRequestSchema,
  WorkspaceSkillTrustService,
  WorkspaceSkillTrustWorkspaceSchema,
  hashWorkspaceRoot,
} from "./workspace-skill-trust"
export type {
  WorkspaceSkillTrustDecisionRequest,
  WorkspaceSkillTrustDecisionResponse,
  WorkspaceSkillTrustListRequest,
  WorkspaceSkillTrustListResponse,
  WorkspaceSkillTrustRecord,
  WorkspaceSkillTrustStatus,
  WorkspaceSkillTrustWorkspace,
} from "./workspace-skill-trust"
```

- [ ] **Step 5: Run service tests**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test test/workspace-skill-trust.test.ts
bunx tsc --noEmit
```

Expected: test passes and typecheck exits 0.

- [ ] **Step 6: Review checkpoint, no Git commit**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub
git status --short
```

Expected: trust service, runtime exports, docs, and test files are modified/untracked. Do not stage or commit.

## Task 3: Runtime Workspace Skill Trust API

**Files:**
- Create: `agent-runtime/src/routers/workspace-skill-trust.ts`
- Modify: `agent-runtime/src/routers/index.ts`
- Modify: `agent-runtime/src/index.ts`
- Test: `agent-runtime/test/workspace-skill-trust-router.test.ts`

- [ ] **Step 1: Write failing router tests**

Create `agent-runtime/test/workspace-skill-trust-router.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { workspaceSkillTrustRouter } from "../src/routers/workspace-skill-trust"
import { WorkspaceSkillTrustService } from "../src/runtime"

async function createApp(): Promise<Hono> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-skill-trust-router-"))
  const service = new WorkspaceSkillTrustService({ dataDir })
  await service.initialize()
  const app = new Hono()
  app.use("*", async (c: Context, next: Next) => {
    c.set("workspaceSkillTrustService", service)
    await next()
  })
  app.route("/", workspaceSkillTrustRouter)
  return app
}

const workspace = {
  workspaceId: "workspace_router",
  backendType: "local" as const,
  rootPath: "D:\\Projects\\Router",
}

describe("workspace Skill trust router", () => {
  test("PUT records trust and query returns metadata without rootPath", async () => {
    const app = await createApp()

    const putResponse = await app.request("/runtime/workspace-skill-trust", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace,
        skillRef: "workspace:agents:review",
        trusted: true,
      }),
    })
    const putBody = await putResponse.json() as {
      record: { trusted: boolean; status: string; workspaceRootHash: string }
    }

    expect(putResponse.status).toBe(200)
    expect(putBody.record).toMatchObject({
      trusted: true,
      status: "trusted",
    })
    expect(putBody.record.workspaceRootHash).toHaveLength(64)

    const queryResponse = await app.request("/runtime/workspace-skill-trust/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace,
        skillRefs: ["workspace:agents:review", "workspace:codex:local"],
      }),
    })
    const queryBody = await queryResponse.json() as {
      trusts: Array<{ skillRef: string; trusted: boolean; status: string }>
    }

    expect(queryResponse.status).toBe(200)
    expect(queryBody.trusts).toContainEqual(expect.objectContaining({
      skillRef: "workspace:agents:review",
      trusted: true,
      status: "trusted",
    }))
    expect(queryBody.trusts).toContainEqual(expect.objectContaining({
      skillRef: "workspace:codex:local",
      trusted: false,
      status: "untrusted",
    }))
    expect(JSON.stringify(queryBody)).not.toContain("D:\\Projects\\Router")
  })

  test("rejects invalid JSON and non-workspace refs with stable error codes", async () => {
    const app = await createApp()

    const invalidJson = await app.request("/runtime/workspace-skill-trust/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    })
    const invalidJsonBody = await invalidJson.json() as { error: { code: string } }

    expect(invalidJson.status).toBe(400)
    expect(invalidJsonBody.error.code).toBe("WORKSPACE_SKILL_TRUST_INVALID_INPUT")

    const invalidRef = await app.request("/runtime/workspace-skill-trust", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace,
        skillRef: "global:agents:review",
        trusted: true,
      }),
    })
    const invalidRefBody = await invalidRef.json() as { error: { code: string } }

    expect(invalidRef.status).toBe(400)
    expect(invalidRefBody.error.code).toBe("WORKSPACE_SKILL_TRUST_REF_INVALID")
  })
})
```

- [ ] **Step 2: Run the failing router test**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test test/workspace-skill-trust-router.test.ts
```

Expected: fails because the router file does not exist.

- [ ] **Step 3: Implement router**

Create `agent-runtime/src/routers/workspace-skill-trust.ts`:

```ts
import { Hono, type Context } from "hono"
import {
  WorkspaceSkillTrustDecisionRequestSchema,
  WorkspaceSkillTrustError,
  WorkspaceSkillTrustListRequestSchema,
  WorkspaceSkillTrustService,
} from "../runtime"

declare module "hono" {
  interface ContextVariableMap {
    workspaceSkillTrustService: WorkspaceSkillTrustService
  }
}

export const workspaceSkillTrustRouter = new Hono()

workspaceSkillTrustRouter.post("/runtime/workspace-skill-trust/query", async (c: Context) => {
  const body = await c.req.json().catch(() => null)
  const parsed = WorkspaceSkillTrustListRequestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({
      error: {
        code: "WORKSPACE_SKILL_TRUST_INVALID_INPUT",
        message: "Invalid workspace Skill trust query.",
        details: parsed.error.issues,
      },
    }, 400)
  }

  try {
    return c.json(await c.get("workspaceSkillTrustService").list(parsed.data))
  } catch (error) {
    return handleWorkspaceSkillTrustError(c, error)
  }
})

workspaceSkillTrustRouter.put("/runtime/workspace-skill-trust", async (c: Context) => {
  const body = await c.req.json().catch(() => null)
  const parsed = WorkspaceSkillTrustDecisionRequestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({
      error: {
        code: "WORKSPACE_SKILL_TRUST_INVALID_INPUT",
        message: "Invalid workspace Skill trust decision.",
        details: parsed.error.issues,
      },
    }, 400)
  }

  try {
    return c.json(await c.get("workspaceSkillTrustService").decide(parsed.data))
  } catch (error) {
    return handleWorkspaceSkillTrustError(c, error)
  }
})

function handleWorkspaceSkillTrustError(c: Context, error: unknown): Response {
  if (error instanceof WorkspaceSkillTrustError) {
    return c.json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    }, error.status as 400)
  }
  throw error
}

export default workspaceSkillTrustRouter
```

- [ ] **Step 4: Register router**

In `agent-runtime/src/routers/index.ts`, add:

```ts
import workspaceSkillTrust from './workspace-skill-trust'
```

Then after `router.route('/', capabilities)` add:

```ts
router.route('/', workspaceSkillTrust)
```

- [ ] **Step 5: Wire service in runtime entrypoint**

In `agent-runtime/src/index.ts`, import `WorkspaceSkillTrustService` from `./runtime`, instantiate it near the other Runtime services:

```ts
const workspaceSkillTrustService = new WorkspaceSkillTrustService({ dataDir: config.dataDir })
```

Add it to the Hono context middleware:

```ts
c.set('workspaceSkillTrustService', workspaceSkillTrustService)
```

Add initialization to `Promise.all`:

```ts
workspaceSkillTrustService.initialize(),
```

Do not pass it to `RunManager` yet; that is Task 5.

- [ ] **Step 6: Run router checks**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test test/workspace-skill-trust.test.ts test/workspace-skill-trust-router.test.ts
bunx tsc --noEmit
```

Expected: tests pass and typecheck exits 0.

- [ ] **Step 7: Review checkpoint, no Git commit**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub
git status --short
```

Expected: router, runtime entrypoint, trust service, docs, and tests are modified/untracked. Do not stage or commit.

## Task 4: Allow Workspace Skill Refs In User Agent Configuration

**Files:**
- Modify: `agent-runtime/src/agents/agent-registry.ts`
- Modify: `agent-runtime/test/agent-skill-configuration.test.ts`

- [ ] **Step 1: Write/update failing configuration test**

In `agent-runtime/test/agent-skill-configuration.test.ts`, replace the current test named `user agents reject workspace allowedSkills until trust exists` with:

```ts
test("user agents preserve workspace allowedSkills but injection still requires trust", async () => {
  const registry = await createRegistry()

  const agent = await registry.createUserAgent({
    id: "workspace_skill_user",
    name: "Workspace Skill User",
    description: "Can reference workspace Skills after Phase 4B.",
    systemPrompt: "Use approved instructions.",
    capabilities: [],
    allowedSubagents: [],
    allowedTools: [],
    allowedSkills: [
      "workspace:agents:local-review",
      " workspace:agents:local-review ",
      "global:agents:review",
    ],
    permissionPolicy: {
      filesystem: "none",
      shell: "none",
      network: "none",
      deploy: "none",
    },
    enabled: true,
  })

  expect(agent.allowedSkills).toEqual([
    "workspace:agents:local-review",
    "global:agents:review",
  ])
})
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test test/agent-skill-configuration.test.ts
```

Expected: fails because `AgentRegistry` still rejects `workspace:*` refs.

- [ ] **Step 3: Relax registry trust-time rejection**

In `agent-runtime/src/agents/agent-registry.ts`, replace `normalizeAllowedSkills` with:

```ts
private normalizeAllowedSkills(skillRefs: string[]): string[] {
  return this.normalizeStringList(skillRefs)
}
```

Remove the `options: { allowWorkspace: boolean }` argument and the block that throws `workspace_skill_requires_trust`.

Keep `AgentSkillRefSchema` unchanged in `agent-runtime/src/agents/types.ts`; it already validates `global|workspace` and source family.

- [ ] **Step 4: Run agent configuration checks**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test test/agent-skill-configuration.test.ts test/agent-crud.test.ts
bunx tsc --noEmit
```

Expected: selected tests pass and typecheck exits 0.

- [ ] **Step 5: Review checkpoint, no Git commit**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub
git status --short
```

Expected: registry/test changes remain unstaged. Do not stage or commit.

## Task 5: Enforce Workspace Skill Trust In RunManager

**Files:**
- Modify: `agent-runtime/src/runtime/run-manager.ts`
- Modify: `agent-runtime/src/index.ts`
- Modify: `agent-runtime/src/runtime/index.ts`
- Modify: `agent-runtime/test/run-manager-skill-injection.test.ts`

- [ ] **Step 1: Add failing untrusted workspace Skill test**

Append this test to `agent-runtime/test/run-manager-skill-injection.test.ts`:

```ts
test("skips untrusted workspace Skill refs with metadata-only diagnostics", async () => {
  const registry = await createRegistry()
  const agent = await registry.createUserAgent({
    id: "workspace_skill_runtime_agent",
    name: "Workspace Skill Runtime Agent",
    description: "References a workspace Skill.",
    systemPrompt: "Follow configured instructions.",
    capabilities: [],
    allowedSubagents: [],
    allowedTools: [],
    allowedSkills: ["workspace:agents:review"],
    permissionPolicy: {
      filesystem: "none",
      shell: "none",
      network: "none",
      deploy: "none",
    },
    enabled: true,
  })

  const toolRegistry = createDefaultRuntimeToolRegistry()
  const skillContentService = {
    async resolve() {
      throw new Error("SkillContentService should not be called for untrusted workspace refs")
    },
  } as unknown as SkillContentService
  const workspaceSkillTrustService = {
    async isTrusted() {
      return false
    },
  }
  const manager = new RunManager(
    registry,
    {} as ProviderService,
    undefined,
    toolRegistry,
    undefined,
    undefined,
    skillContentService,
    workspaceSkillTrustService as any,
  )

  let observedSkills: ResolvedSkillContent[] | undefined
  ;(manager as any).aiSdkExecutor = {
    executorType: "ai-sdk",
    async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
      observedSkills = context.injectedSkills
      yield createRunEvent(context.runId, "agent.started", context.agent.id, {})
      yield createRunEvent(context.runId, "agent.completed", context.agent.id, { status: "completed" })
    },
  }

  const run = manager.createRun({
    conversationId: "conv_workspace_skill_untrusted",
    mode: "single",
    participantAgentIds: [agent.id],
    addressedAgentIds: [agent.id],
    userMessage: {
      role: "user",
      content: "Use workspace skill if trusted.",
    },
    history: [],
    workspace: {
      workspaceId: "workspace_untrusted",
      backendType: "local",
      rootPath: "D:\\Projects\\Untrusted",
    },
    diagnostics: {
      includeSkillDiagnostics: true,
    },
  })

  await waitForStatus(manager, run.id, "completed")

  expect(observedSkills).toEqual([])
  const diagnostic = manager.getEvents(run.id)?.find((event) =>
    event.type === "agent.skill_context.resolved"
  )
  expect(diagnostic?.data).toMatchObject({
    status: "skipped",
    skills: [],
    warnings: expect.arrayContaining([
      "Workspace Skill workspace:agents:review is not trusted for this workspace.",
    ]),
  })
  expect(JSON.stringify(diagnostic)).not.toContain("D:\\Projects\\Untrusted")
})
```

- [ ] **Step 2: Add failing trusted workspace Skill test**

Append this test to the same file:

```ts
test("injects trusted workspace Skill refs for user agents", async () => {
  const registry = await createRegistry()
  const agent = await registry.createUserAgent({
    id: "trusted_workspace_skill_agent",
    name: "Trusted Workspace Skill Agent",
    description: "Uses trusted workspace Skills.",
    systemPrompt: "Follow configured instructions.",
    capabilities: [],
    allowedSubagents: [],
    allowedTools: [],
    allowedSkills: ["workspace:agents:review"],
    permissionPolicy: {
      filesystem: "none",
      shell: "none",
      network: "none",
      deploy: "none",
    },
    enabled: true,
  })

  const workspace = {
    workspaceId: "workspace_trusted",
    backendType: "local" as const,
    rootPath: "D:\\Projects\\Trusted",
  }
  const workspaceSkill: ResolvedSkillContent = {
    ...resolvedSkill,
    id: "workspace:agents:review",
    ref: "workspace:agents:review",
    level: "workspace",
  }
  const skillContentService = {
    async resolve(request: { skillRefs: string[]; workspace?: typeof workspace }) {
      expect(request.skillRefs).toEqual(["workspace:agents:review"])
      expect(request.workspace).toEqual(workspace)
      return { skills: [workspaceSkill], warnings: [] }
    },
  } as unknown as SkillContentService
  const workspaceSkillTrustService = {
    async isTrusted(request: { workspace: typeof workspace; skillRef: string }) {
      expect(request.workspace).toEqual(workspace)
      expect(request.skillRef).toBe("workspace:agents:review")
      return true
    },
  }
  const manager = new RunManager(
    registry,
    {} as ProviderService,
    undefined,
    createDefaultRuntimeToolRegistry(),
    undefined,
    undefined,
    skillContentService,
    workspaceSkillTrustService as any,
  )

  let observedSkills: ResolvedSkillContent[] | undefined
  ;(manager as any).aiSdkExecutor = {
    executorType: "ai-sdk",
    async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
      observedSkills = context.injectedSkills
      yield createRunEvent(context.runId, "agent.started", context.agent.id, {})
      yield createRunEvent(context.runId, "agent.completed", context.agent.id, { status: "completed" })
    },
  }

  const run = manager.createRun({
    conversationId: "conv_workspace_skill_trusted",
    mode: "single",
    participantAgentIds: [agent.id],
    addressedAgentIds: [agent.id],
    userMessage: {
      role: "user",
      content: "Use trusted workspace skill.",
    },
    history: [],
    workspace,
    diagnostics: {
      includeSkillDiagnostics: true,
    },
  })

  await waitForStatus(manager, run.id, "completed")

  expect(observedSkills?.[0]?.ref).toBe("workspace:agents:review")
  expect(observedSkills?.[0]?.body).toContain("Always inspect tests")
  const diagnostic = manager.getEvents(run.id)?.find((event) =>
    event.type === "agent.skill_context.resolved"
  )
  expect(diagnostic?.data).toMatchObject({
    status: "resolved",
    skills: [
      expect.objectContaining({
        ref: "workspace:agents:review",
        level: "workspace",
      }),
    ],
    warnings: [],
  })
  expect(JSON.stringify(diagnostic)).not.toContain("Always inspect tests")
  expect(JSON.stringify(diagnostic)).not.toContain("D:\\Projects\\Trusted")
})
```

- [ ] **Step 3: Run failing RunManager tests**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test test/run-manager-skill-injection.test.ts
```

Expected: fails because user agents now preserve workspace refs but `RunManager` still filters them out.

- [ ] **Step 4: Add RunManager dependency and trust selection**

In `agent-runtime/src/runtime/run-manager.ts`, import:

```ts
import type { WorkspaceSkillTrustService } from "./workspace-skill-trust"
```

Change the constructor tail to:

```ts
    systemModelSettingsService?: SystemModelSettingsService,
    private skillContentService?: SkillContentService,
    private workspaceSkillTrustService?: WorkspaceSkillTrustService
```

Add this local type near `TaskDispatchOptions`:

```ts
type SkillRefSelection = {
  skillRefs: string[]
  warnings: string[]
}
```

Replace `injectableSkillRefs(agent: AgentDefinition): string[]` with:

```ts
private async selectInjectableSkillRefs(run: RunRecord, agent: AgentDefinition): Promise<SkillRefSelection> {
  if (!this.isSkillInjectableExecutor(agent)) {
    return agent.allowedSkills.length > 0
      ? {
          skillRefs: [],
          warnings: ["Skill refs are not injectable for this executor type."],
        }
      : { skillRefs: [], warnings: [] }
  }

  const skillRefs: string[] = []
  const warnings: string[] = []
  for (const skillRef of agent.allowedSkills) {
    if (skillRef.startsWith("global:")) {
      skillRefs.push(skillRef)
      continue
    }

    if (!skillRef.startsWith("workspace:")) {
      warnings.push(`Skill ${skillRef} is not injectable under the current trust policy.`)
      continue
    }

    if (!run.input.workspace) {
      warnings.push(`Workspace Skill ${skillRef} requires a bound workspace.`)
      continue
    }

    if (!this.workspaceSkillTrustService) {
      warnings.push(`Workspace Skill ${skillRef} requires workspace trust service.`)
      continue
    }

    const trusted = await this.workspaceSkillTrustService.isTrusted({
      workspace: run.input.workspace,
      skillRef,
    })
    if (trusted) {
      skillRefs.push(skillRef)
    } else {
      warnings.push(`Workspace Skill ${skillRef} is not trusted for this workspace.`)
    }
  }

  return { skillRefs, warnings }
}
```

Change `resolveSkillContext` to:

```ts
private async resolveSkillContext(run: RunRecord, agent: AgentDefinition): Promise<SkillContentResolution> {
  const selection = await this.selectInjectableSkillRefs(run, agent)
  if (selection.skillRefs.length === 0) {
    return {
      skills: [],
      warnings: selection.warnings,
    }
  }

  if (!this.skillContentService) {
    return {
      skills: [],
      warnings: [...selection.warnings, "Skill context service is unavailable."],
    }
  }

  try {
    const resolution = await this.skillContentService.resolve({
      skillRefs: selection.skillRefs,
      workspace: run.input.workspace,
    })
    return {
      skills: resolution.skills,
      warnings: [...selection.warnings, ...resolution.warnings],
    }
  } catch {
    return {
      skills: [],
      warnings: [...selection.warnings, "Skill context resolution failed."],
    }
  }
}
```

Change `createSkillContextResolvedEvent` status calculation to compare against all configured Skill refs:

```ts
const expectedSkillCount = agent.allowedSkills.length
```

Remove any remaining call to the old synchronous `injectableSkillRefs`.

- [ ] **Step 5: Wire trust service in runtime entrypoint**

In `agent-runtime/src/index.ts`, pass the service to RunManager:

```ts
const runManager = new RunManager(
  agentRegistry,
  providerService,
  undefined,
  toolRegistry,
  undefined,
  systemModelSettingsService,
  skillContentService,
  workspaceSkillTrustService
)
```

- [ ] **Step 6: Export trust service types if not already exported**

If Task 2 did not already export the trust service and types from `agent-runtime/src/runtime/index.ts`, add the exports from Task 2 Step 4 now.

- [ ] **Step 7: Run RunManager checks**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test test/run-manager-skill-injection.test.ts test/skill-content.test.ts test/skill-prompt.test.ts
bunx tsc --noEmit
```

Expected: selected tests pass and typecheck exits 0.

- [ ] **Step 8: Review checkpoint, no Git commit**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub
git status --short
```

Expected: RunManager, runtime entrypoint, runtime exports, trust service/router, docs, and tests are modified/untracked. Do not stage or commit.

## Task 6: Contract Regression And Security Verification

**Files:**
- No new source edits unless verification exposes a defect.

- [ ] **Step 1: Run focused Runtime test set**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test test/workspace-skill-trust.test.ts test/workspace-skill-trust-router.test.ts test/agent-skill-configuration.test.ts test/run-manager-skill-injection.test.ts test/capability-discovery.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 2: Run full Runtime typecheck**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bunx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 3: Run full Runtime test suite**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub\agent-runtime
bun test
```

Expected: exits 0; optional external smoke tests remain skipped unless explicitly enabled.

- [ ] **Step 4: Run security scan for response leaks**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub
Get-ChildItem -Path agent-runtime/src,agent-runtime/test -Recurse -File |
  Select-String -Pattern 'workspaceRootHash|rootPath|workspace-skill-trust|skill_context|SkillInstructions|body:' |
  ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" }
```

Expected:

- Trust API responses include `workspaceRootHash` but never `rootPath`.
- Tests may contain fake `rootPath` values, but production response mapping does not return them.
- `agent.skill_context.resolved` still maps only metadata and never maps `body`.
- Skill body appears only in `skill-content.ts`, `skill-prompt.ts`, and tests that explicitly assert prompt injection behavior.

- [ ] **Step 5: Final review checkpoint, no Git commit**

Run:

```powershell
cd D:\PyWorkSpace\AgentHub
git status --short
git diff --stat
```

Expected: all intended files are modified/untracked for user review. Do not stage, commit, push, amend, rebase, or rewrite history.

## Acceptance Criteria

- Runtime docs and API contracts describe Phase 4B Workspace Skill Trust and explicitly say no frontend/HubServer implementation is included in this batch.
- `WorkspaceSkillTrustService` persists trust records under Runtime `dataDir` without storing or returning workspace root absolute paths.
- Runtime exposes internal `POST /runtime/workspace-skill-trust/query` and `PUT /runtime/workspace-skill-trust` endpoints with stable error codes.
- User custom agents can persist `workspace:*` refs in `allowedSkills`.
- `RunManager` injects `workspace:*` Skill bodies only when the current Run has a bound workspace and trust service returns trusted for the exact `{ workspaceId, rootPath hash, skillRef }`.
- Untrusted or missing-workspace workspace Skill refs degrade to metadata-only warnings and do not fail the Run.
- Global Skill injection behavior from Phase 4A remains unchanged.
- External adapters, Instruct Agent, MCP discovery, and MCP execution behavior remain unchanged.
- Runtime API responses and `agent.skill_context.resolved` diagnostics do not expose Skill body text or workspace root paths.
- All relevant Runtime tests and `bunx tsc --noEmit` pass.
- No Git commit is created by the implementing agent; the user reviews and commits manually.

## Self-Review

- Spec coverage: The plan covers docs, data model, Runtime API, agent configuration, RunManager enforcement, tests, and security scan for Runtime-only Phase 4B. It excludes Web and HubServer as requested.
- Placeholder scan: No `TBD`, `TODO`, vague "add tests", or unspecified implementation slots remain.
- Type consistency: `WorkspaceSkillTrustService`, request/response schemas, router context key `workspaceSkillTrustService`, `RunManager` constructor dependency, and `workspace:*` refs are named consistently across tasks.
- Git instruction consistency: Every task ends with a review checkpoint and explicitly forbids staging, committing, pushing, or rewriting Git history.
