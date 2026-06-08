import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"

export const WorkspaceSkillTrustSourceSchema = z.enum([
  "agents",
  "codex",
  "claude-code",
  "opencode",
])

const WorkspaceSkillRefSchema = z.string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^workspace:(agents|codex|claude-code|opencode):[A-Za-z0-9._:-]+$/)

const SkillRefInputSchema = z.string().trim().min(1).max(300)

export const WorkspaceSkillTrustWorkspaceSchema = z.object({
  workspaceId: z.string().trim().min(1),
  backendType: z.literal("local"),
  rootPath: z.string().trim().min(1),
}).strict()

export type WorkspaceSkillTrustWorkspace = z.infer<typeof WorkspaceSkillTrustWorkspaceSchema>

export const WorkspaceSkillTrustListRequestSchema = z.object({
  workspace: WorkspaceSkillTrustWorkspaceSchema,
  skillRefs: z.array(SkillRefInputSchema).optional(),
}).strict()

export type WorkspaceSkillTrustListRequest = z.infer<typeof WorkspaceSkillTrustListRequestSchema>

export const WorkspaceSkillTrustDecisionRequestSchema = z.object({
  workspace: WorkspaceSkillTrustWorkspaceSchema,
  skillRef: SkillRefInputSchema,
  trusted: z.boolean(),
  reason: z.string().trim().max(500).optional(),
}).strict()

export type WorkspaceSkillTrustDecisionRequest = z.infer<typeof WorkspaceSkillTrustDecisionRequestSchema>

export type WorkspaceSkillTrustSource = z.infer<typeof WorkspaceSkillTrustSourceSchema>
export type WorkspaceSkillTrustStatus = "trusted" | "untrusted"

export type WorkspaceSkillTrustRecord = {
  workspaceId: string
  backendType: "local"
  workspaceRootHash: string
  skillRef: string
  source: WorkspaceSkillTrustSource
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
  private initialized = false
  private records = new Map<string, WorkspaceSkillTrustRecord>()

  constructor(options: WorkspaceSkillTrustServiceOptions) {
    this.filePath = options.filePath ?? join(options.dataDir, "workspace-skill-trust.json")
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      const raw = await readFile(this.filePath, "utf-8")
      const parsed = StoredWorkspaceSkillTrustFileSchema.safeParse(JSON.parse(raw))
      if (parsed.success) {
        for (const record of parsed.data.records) {
          this.records.set(
            createTrustKey(record.workspaceId, record.workspaceRootHash, record.skillRef),
            record,
          )
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
          this.records.get(createTrustKey(request.workspace.workspaceId, workspaceRootHash, skillRef))
          ?? createUntrustedRecord(request.workspace, workspaceRootHash, skillRef)
        )
      : Array.from(this.records.values())
        .filter((record) =>
          record.workspaceId === request.workspace.workspaceId
          && record.workspaceRootHash === workspaceRootHash
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
    const workspace = parseWorkspace(input.workspace)
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
          .sort((left, right) =>
            createTrustKey(left.workspaceId, left.workspaceRootHash, left.skillRef)
              .localeCompare(createTrustKey(right.workspaceId, right.workspaceRootHash, right.skillRef))
          ),
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

const WorkspaceSkillTrustRecordSchema: z.ZodType<WorkspaceSkillTrustRecord> = z.object({
  workspaceId: z.string(),
  backendType: z.literal("local"),
  workspaceRootHash: z.string(),
  skillRef: z.string(),
  source: WorkspaceSkillTrustSourceSchema,
  trusted: z.boolean(),
  status: z.enum(["trusted", "untrusted"]),
  trustedAt: z.string().optional(),
  revokedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const StoredWorkspaceSkillTrustFileSchema: z.ZodType<StoredWorkspaceSkillTrustFile> = z.object({
  version: z.literal(1),
  records: z.array(WorkspaceSkillTrustRecordSchema),
})

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

function parseWorkspace(input: WorkspaceSkillTrustWorkspace): WorkspaceSkillTrustWorkspace {
  const parsed = WorkspaceSkillTrustWorkspaceSchema.safeParse(input)
  if (!parsed.success) {
    throw new WorkspaceSkillTrustError(
      "WORKSPACE_SKILL_TRUST_INVALID_INPUT",
      "Invalid workspace Skill trust workspace.",
      400,
      parsed.error.issues,
    )
  }
  return parsed.data
}

function parseWorkspaceSkillRef(skillRef: string): string {
  const parsed = WorkspaceSkillRefSchema.safeParse(skillRef)
  if (!parsed.success) {
    throw new WorkspaceSkillTrustError(
      "WORKSPACE_SKILL_TRUST_REF_INVALID",
      "Skill ref must be a valid workspace Skill ref.",
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
  now = new Date().toISOString(),
): WorkspaceSkillTrustRecord {
  return {
    workspaceId: workspace.workspaceId,
    backendType: "local",
    workspaceRootHash,
    skillRef,
    source: parseWorkspaceSkillSource(skillRef),
    trusted: false,
    status: "untrusted",
    createdAt: now,
    updatedAt: now,
  }
}

function parseWorkspaceSkillSource(skillRef: string): WorkspaceSkillTrustSource {
  const source = skillRef.split(":")[1]
  return WorkspaceSkillTrustSourceSchema.parse(source)
}

function createTrustKey(workspaceId: string, workspaceRootHash: string, skillRef: string): string {
  return `${workspaceId}:${workspaceRootHash}:${skillRef}`
}

export function hashWorkspaceRoot(rootPath: string): string {
  return createHash("sha256")
    .update(rootPath.trim().toLowerCase())
    .digest("hex")
}
