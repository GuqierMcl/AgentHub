import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"

export const McpTrustScopeSchema = z.enum(["global", "workspace"])

const McpRefSchema = z.string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^[A-Za-z0-9:._-]+$/)

const McpRefInputSchema = z.string().trim().min(1).max(500)

export const McpTrustWorkspaceSchema = z.object({
  workspaceId: z.string().trim().min(1),
  backendType: z.literal("local"),
  rootPath: z.string().trim().min(1),
}).strict()

export type McpTrustWorkspace = z.infer<typeof McpTrustWorkspaceSchema>

export const McpTrustListRequestSchema = z.object({
  scope: McpTrustScopeSchema,
  workspace: McpTrustWorkspaceSchema.optional(),
  mcpRefs: z.array(McpRefInputSchema).optional(),
}).strict()

export type McpTrustListRequest = z.infer<typeof McpTrustListRequestSchema>

export const McpTrustDecisionRequestSchema = z.object({
  scope: McpTrustScopeSchema,
  workspace: McpTrustWorkspaceSchema.optional(),
  mcpRef: McpRefInputSchema,
  trusted: z.boolean(),
  reason: z.string().trim().max(500).optional(),
}).strict()

export type McpTrustDecisionRequest = z.infer<typeof McpTrustDecisionRequestSchema>

export type McpTrustScope = z.infer<typeof McpTrustScopeSchema>
export type McpTrustStatus = "trusted" | "untrusted"

export type McpTrustRecord = {
  scope: McpTrustScope
  level: McpTrustScope
  workspaceId?: string
  backendType?: "local"
  workspaceRootHash?: string
  mcpRef: string
  trusted: boolean
  status: McpTrustStatus
  trustedAt?: string
  revokedAt?: string
  createdAt: string
  updatedAt: string
}

export type McpTrustListResponse = {
  checkedAt: string
  scope: McpTrustScope
  workspace?: {
    workspaceId: string
    backendType: "local"
    workspaceRootHash: string
  }
  trusts: McpTrustRecord[]
}

export type McpTrustDecisionResponse = {
  record: McpTrustRecord
}

export type McpRuntimeStatusItem = {
  id: "mcp-runtime"
  label: "MCP Runtime"
  kind: "runtime-capability"
  status: "idle" | "error"
  implemented: true
  checkedAt: string
  details: {
    trustedRecordCount: number
    latestError?: string
  }
}

type StoredMcpTrustFile = {
  version: 1
  records: McpTrustRecord[]
}

export class McpTrustError extends Error {
  constructor(
    public code:
      | "MCP_TRUST_INVALID_INPUT"
      | "MCP_TRUST_WORKSPACE_REQUIRED"
      | "MCP_TRUST_REF_INVALID"
      | "MCP_TRUST_STORE_FAILED",
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message)
    this.name = "McpTrustError"
  }
}

export type McpTrustServiceOptions = {
  dataDir: string
  filePath?: string
}

export class McpTrustService {
  private filePath: string
  private initialized = false
  private records = new Map<string, McpTrustRecord>()
  private latestError?: string

  constructor(options: McpTrustServiceOptions) {
    this.filePath = options.filePath ?? join(options.dataDir, "mcp-trust.json")
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      const raw = await readFile(this.filePath, "utf-8")
      const parsed = StoredMcpTrustFileSchema.safeParse(JSON.parse(raw))
      if (parsed.success) {
        for (const record of parsed.data.records) {
          this.records.set(createTrustKey(record), record)
        }
        this.latestError = undefined
      } else {
        this.records.clear()
        this.latestError = "MCP trust store could not be parsed."
      }
    } catch (error) {
      this.records.clear()
      if (!isFileMissingError(error)) {
        this.latestError = sanitizeStatusError(error instanceof Error ? error.message : String(error))
      }
    }

    this.initialized = true
  }

  async list(input: McpTrustListRequest): Promise<McpTrustListResponse> {
    await this.initialize()
    const request = parseListRequest(input)
    const workspaceContext = createWorkspaceContext(request.scope, request.workspace)

    const trusts = request.mcpRefs?.length
      ? request.mcpRefs.map((mcpRef) =>
          this.records.get(createTrustKeyFromParts(request.scope, workspaceContext?.workspaceId, workspaceContext?.workspaceRootHash, mcpRef))
          ?? createDefaultTrustedRecord(request.scope, workspaceContext, mcpRef)
        )
      : Array.from(this.records.values())
        .filter((record) => recordMatchesScope(record, request.scope, workspaceContext))
        .sort((left, right) => left.mcpRef.localeCompare(right.mcpRef))

    return {
      checkedAt: new Date().toISOString(),
      scope: request.scope,
      ...(workspaceContext ? { workspace: workspaceContext.response } : {}),
      trusts,
    }
  }

  async decide(input: McpTrustDecisionRequest): Promise<McpTrustDecisionResponse> {
    await this.initialize()
    const request = parseDecisionRequest(input)
    const workspaceContext = createWorkspaceContext(request.scope, request.workspace)
    const key = createTrustKeyFromParts(
      request.scope,
      workspaceContext?.workspaceId,
      workspaceContext?.workspaceRootHash,
      request.mcpRef,
    )
    const existing = this.records.get(key)
    const now = new Date().toISOString()
    const record: McpTrustRecord = {
      ...(existing ?? createDefaultTrustedRecord(request.scope, workspaceContext, request.mcpRef, now)),
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
    scope: McpTrustScope
    workspace?: McpTrustWorkspace
    mcpRef: string
  }): Promise<boolean> {
    await this.initialize()
    const scope = McpTrustScopeSchema.parse(input.scope)
    const mcpRef = parseMcpRef(input.mcpRef)
    const workspaceContext = createWorkspaceContext(scope, input.workspace)
    const record = this.records.get(createTrustKeyFromParts(
      scope,
      workspaceContext?.workspaceId,
      workspaceContext?.workspaceRootHash,
      mcpRef,
    ))
    return record ? record.trusted === true : true
  }

  getStatus(): McpRuntimeStatusItem {
    return {
      id: "mcp-runtime",
      label: "MCP Runtime",
      kind: "runtime-capability",
      status: this.latestError ? "error" : "idle",
      implemented: true,
      checkedAt: new Date().toISOString(),
      details: {
        trustedRecordCount: this.records.size,
        ...(this.latestError ? { latestError: this.latestError } : {}),
      },
    }
  }

  private async save(): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      const payload: StoredMcpTrustFile = {
        version: 1,
        records: Array.from(this.records.values())
          .sort((left, right) => createTrustKey(left).localeCompare(createTrustKey(right))),
      }
      await writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
      this.latestError = undefined
    } catch (error) {
      this.latestError = sanitizeStatusError(error instanceof Error ? error.message : String(error))
      throw new McpTrustError(
        "MCP_TRUST_STORE_FAILED",
        "MCP trust store could not be saved.",
        500,
      )
    }
  }
}

const McpTrustRecordSchema: z.ZodType<McpTrustRecord> = z.object({
  scope: McpTrustScopeSchema,
  level: McpTrustScopeSchema,
  workspaceId: z.string().optional(),
  backendType: z.literal("local").optional(),
  workspaceRootHash: z.string().optional(),
  mcpRef: z.string(),
  trusted: z.boolean(),
  status: z.enum(["trusted", "untrusted"]),
  trustedAt: z.string().optional(),
  revokedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const StoredMcpTrustFileSchema: z.ZodType<StoredMcpTrustFile> = z.object({
  version: z.literal(1),
  records: z.array(McpTrustRecordSchema),
})

type WorkspaceContext = {
  workspaceId: string
  workspaceRootHash: string
  response: {
    workspaceId: string
    backendType: "local"
    workspaceRootHash: string
  }
}

function parseListRequest(input: McpTrustListRequest): McpTrustListRequest {
  const parsed = McpTrustListRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new McpTrustError(
      "MCP_TRUST_INVALID_INPUT",
      "Invalid MCP trust query.",
      400,
      parsed.error.issues,
    )
  }
  for (const mcpRef of parsed.data.mcpRefs ?? []) {
    parseMcpRef(mcpRef)
  }
  return parsed.data
}

function parseDecisionRequest(input: McpTrustDecisionRequest): McpTrustDecisionRequest {
  const parsed = McpTrustDecisionRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new McpTrustError(
      "MCP_TRUST_INVALID_INPUT",
      "Invalid MCP trust decision.",
      400,
      parsed.error.issues,
    )
  }
  parseMcpRef(parsed.data.mcpRef)
  return parsed.data
}

function parseMcpRef(mcpRef: string): string {
  const parsed = McpRefSchema.safeParse(mcpRef)
  if (!parsed.success) {
    throw new McpTrustError(
      "MCP_TRUST_REF_INVALID",
      "MCP ref must be a valid capability discovery MCP id.",
      400,
      parsed.error.issues,
    )
  }
  return parsed.data
}

function createWorkspaceContext(scope: McpTrustScope, workspace?: McpTrustWorkspace): WorkspaceContext | undefined {
  if (scope === "global") return undefined
  if (!workspace) {
    throw new McpTrustError(
      "MCP_TRUST_WORKSPACE_REQUIRED",
      "Workspace MCP trust requires a workspace snapshot.",
      400,
    )
  }

  const parsed = McpTrustWorkspaceSchema.safeParse(workspace)
  if (!parsed.success) {
    throw new McpTrustError(
      "MCP_TRUST_INVALID_INPUT",
      "Invalid MCP trust workspace.",
      400,
      parsed.error.issues,
    )
  }

  const workspaceRootHash = hashMcpTrustWorkspaceRoot(parsed.data.rootPath)
  return {
    workspaceId: parsed.data.workspaceId,
    workspaceRootHash,
    response: {
      workspaceId: parsed.data.workspaceId,
      backendType: "local",
      workspaceRootHash,
    },
  }
}

function createDefaultTrustedRecord(
  scope: McpTrustScope,
  workspaceContext: WorkspaceContext | undefined,
  mcpRef: string,
  now = new Date().toISOString(),
): McpTrustRecord {
  return {
    scope,
    level: scope,
    ...(workspaceContext
      ? {
          workspaceId: workspaceContext.workspaceId,
          backendType: "local" as const,
          workspaceRootHash: workspaceContext.workspaceRootHash,
        }
      : {}),
    mcpRef,
    trusted: true,
    status: "trusted",
    createdAt: now,
    updatedAt: now,
  }
}

function recordMatchesScope(
  record: McpTrustRecord,
  scope: McpTrustScope,
  workspaceContext: WorkspaceContext | undefined,
): boolean {
  if (record.scope !== scope) return false
  if (scope === "global") return true
  return (
    record.workspaceId === workspaceContext?.workspaceId
    && record.workspaceRootHash === workspaceContext?.workspaceRootHash
  )
}

function createTrustKey(record: McpTrustRecord): string {
  return createTrustKeyFromParts(record.scope, record.workspaceId, record.workspaceRootHash, record.mcpRef)
}

function createTrustKeyFromParts(
  scope: McpTrustScope,
  workspaceId: string | undefined,
  workspaceRootHash: string | undefined,
  mcpRef: string,
): string {
  return scope === "global"
    ? `global:${mcpRef}`
    : `workspace:${workspaceId ?? ""}:${workspaceRootHash ?? ""}:${mcpRef}`
}

export function hashMcpTrustWorkspaceRoot(rootPath: string): string {
  return createHash("sha256")
    .update(rootPath.trim().toLowerCase())
    .digest("hex")
}

function isFileMissingError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT"
}

function sanitizeStatusError(message: string): string {
  return message
    .replace(/[A-Za-z]:\\[^\s"'`<>]+/g, "[REDACTED_PATH]")
    .replace(/(^|\s)\/(?:[^/\s"'`<>]+\/)+[^/\s"'`<>]*/g, "$1[REDACTED_PATH]")
    .replace(/(token|secret|password|passwd|api[-_]?key|authorization|credential)=([^\s&]+)/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/(sk-|ghp_|github_pat_|xox[baprs]-|ya29\.|eyJ)[A-Za-z0-9._-]{8,}/g, "[REDACTED]")
    .slice(0, 500)
}
