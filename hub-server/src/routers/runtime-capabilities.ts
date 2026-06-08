import { createHash } from "node:crypto"
import path from "node:path"
import { Hono, type Context } from "hono"
import { z } from "zod"
import { AppError } from "../lib/errors"
import type { RuntimeClient } from "../lib/runtime"
import type { ConversationService } from "../services/conversation.service"

declare module "hono" {
  interface ContextVariableMap {
    runtimeClient: RuntimeClient
    conversationService: ConversationService
  }
}

const runtimeCapabilities = new Hono()

const RuntimeCapabilitiesQuerySchema = z.object({
  scope: z.enum(["global", "workspace"]).default("global"),
  conversationId: z.string().trim().min(1).optional(),
}).strict()

const CapabilitySourceSchema = z.enum(["agents", "codex", "claude-code", "opencode"])

const RuntimeCapabilitiesRefreshBodySchema = z.object({
  scope: z.enum(["global", "workspace"]).default("global"),
  conversationId: z.string().trim().min(1).optional(),
  sources: z.array(CapabilitySourceSchema).optional(),
}).strict()

type CapabilitySource = z.infer<typeof CapabilitySourceSchema>
type CapabilityScope = "global" | "workspace"

type WorkspaceSnapshot = {
  workspaceId: string
  backendType: "local"
  rootPath: string
}

type WorkspaceConversation = {
  id: string
  title: string
  metadata: Record<string, unknown> | null
}

type RuntimeCapabilityData = {
  discoveredAt: string
  skills: unknown[]
  mcps: unknown[]
  warnings: string[]
  cache?: unknown
}

type WorkspaceResolutionGroup = {
  key: string
  snapshot: WorkspaceSnapshot
  title: string
  conversationId: string
  conversationIds: string[]
}

type WorkspaceResolution = {
  groups: WorkspaceResolutionGroup[]
  warnings: string[]
}

type WorkspaceCapabilityGroup = {
  workspaceKey: string
  workspaceId: string
  backendType: "local"
  rootPath: string
  conversationId: string
  conversationIds: string[]
  title: string
  discoveredAt: string
  skills: unknown[]
  mcps: unknown[]
  warnings: string[]
  cache?: unknown
}

runtimeCapabilities.get("/api/runtime/capabilities", async (c: Context) => {
  const query = RuntimeCapabilitiesQuerySchema.safeParse({
    scope: c.req.query("scope") ?? "global",
    conversationId: c.req.query("conversationId"),
  })

  if (!query.success) {
    return c.json({
      error: {
        code: "CAPABILITY_INVALID_INPUT",
        message: "Invalid runtime capabilities query.",
        details: query.error.issues,
      },
    }, 400)
  }

  if (query.data.scope === "workspace") {
    return forwardWorkspaceCapabilities(
      c,
      "/runtime/capabilities/discover",
      query.data.conversationId,
    )
  }

  return forwardGlobalCapabilities(c, "/runtime/capabilities/discover", query.data.scope)
})

runtimeCapabilities.post("/api/runtime/capabilities/refresh", async (c: Context) => {
  const body = await readJsonBody(c)
  const input = RuntimeCapabilitiesRefreshBodySchema.safeParse(body)

  if (!input.success) {
    return c.json({
      error: {
        code: "CAPABILITY_INVALID_INPUT",
        message: "Invalid runtime capabilities refresh body.",
        details: input.error.issues,
      },
    }, 400)
  }

  if (input.data.scope === "workspace") {
    return forwardWorkspaceCapabilities(
      c,
      "/runtime/capabilities/refresh",
      input.data.conversationId,
      input.data.sources,
    )
  }

  return forwardGlobalCapabilities(
    c,
    "/runtime/capabilities/refresh",
    input.data.scope,
    input.data.sources,
  )
})

async function forwardGlobalCapabilities(
  c: Context,
  endpoint: string,
  scope: CapabilityScope,
  sources?: CapabilitySource[],
) {
  const client = c.get("runtimeClient")
  const { data, status } = await client.forward(
    "POST",
    endpoint,
    {
      scope,
      ...(sources ? { sources } : {}),
    },
    { raw: true },
  )
  return c.json(data, status as 200)
}

async function forwardWorkspaceCapabilities(
  c: Context,
  endpoint: string,
  conversationId?: string,
  sources?: CapabilitySource[],
) {
  const resolution = await resolveWorkspaceGroups(c, conversationId)
  const client = c.get("runtimeClient")
  const workspaces: WorkspaceCapabilityGroup[] = []
  const warnings = [...resolution.warnings]
  let discoveredAt: string | undefined

  for (const group of resolution.groups) {
    const { data, status } = await client.forward(
      "POST",
      endpoint,
      {
        scope: "workspace",
        ...(sources ? { sources } : {}),
        workspace: group.snapshot,
      },
      { raw: true },
    )

    if (status < 200 || status >= 300) {
      return c.json(data, status as 200)
    }

    const runtimeData = normalizeRuntimeCapabilityData(data)
    discoveredAt = latestIso(discoveredAt, runtimeData.discoveredAt)
    warnings.push(...runtimeData.warnings)
    workspaces.push({
      workspaceKey: group.key,
      workspaceId: group.snapshot.workspaceId,
      backendType: "local",
      rootPath: group.snapshot.rootPath,
      conversationId: group.conversationId,
      conversationIds: group.conversationIds,
      title: group.title,
      discoveredAt: runtimeData.discoveredAt,
      skills: runtimeData.skills,
      mcps: runtimeData.mcps,
      warnings: runtimeData.warnings,
      ...(runtimeData.cache ? { cache: runtimeData.cache } : {}),
    })
  }

  return c.json({
    discoveredAt: discoveredAt ?? new Date().toISOString(),
    scope: "workspace",
    workspaces,
    warnings,
  }, 200)
}

async function resolveWorkspaceGroups(
  c: Context,
  conversationId?: string,
): Promise<WorkspaceResolution> {
  const service = c.get("conversationService")
  const conversations = conversationId
    ? [await service.getConversationDetail(conversationId)]
    : await service.listConversations("active")
  const groups = new Map<string, WorkspaceResolutionGroup>()
  const warnings: string[] = []

  for (const conversation of conversations) {
    const snapshot = getWorkspaceSnapshot(conversation)
    if (!snapshot) {
      if (conversationId) {
        throw workspaceNotResolved("Conversation workspace metadata is incomplete.")
      }
      warnings.push(`Conversation ${conversation.id} has no local workspace root.`)
      continue
    }

    const canonicalRoot = canonicalizeRootPath(snapshot.rootPath)
    const key = createWorkspaceKey(canonicalRoot)
    const existing = groups.get(key)
    if (existing) {
      existing.conversationIds.push(conversation.id)
      continue
    }

    groups.set(key, {
      key,
      snapshot,
      title: workspaceTitle(snapshot.rootPath),
      conversationId: conversation.id,
      conversationIds: [conversation.id],
    })
  }

  if (groups.size === 0) {
    throw workspaceNotResolved(
      conversationId
        ? "Conversation has no bound workspace."
        : "No active conversation has a local workspace root.",
    )
  }

  return {
    groups: Array.from(groups.values()),
    warnings,
  }
}

function getWorkspaceSnapshot(conversation: WorkspaceConversation): WorkspaceSnapshot | null {
  const workspace = getRecord(conversation.metadata)?.workspace
  if (!isRecord(workspace)) {
    return null
  }

  if (
    typeof workspace.workspaceId !== "string" ||
    workspace.backendType !== "local" ||
    typeof workspace.rootPath !== "string" ||
    workspace.rootPath.trim().length === 0
  ) {
    return null
  }

  return {
    workspaceId: workspace.workspaceId,
    backendType: "local",
    rootPath: workspace.rootPath.trim(),
  }
}

function workspaceNotResolved(message: string): AppError {
  return new AppError(400, "WORKSPACE_NOT_RESOLVED", message)
}

function createWorkspaceKey(canonicalRoot: string): string {
  const hash = createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 16)
  return `workspace:${hash}`
}

function canonicalizeRootPath(rootPath: string): string {
  const trimmed = rootPath.trim()
  const resolved = looksLikeWindowsPath(trimmed)
    ? path.win32.resolve(trimmed)
    : path.resolve(trimmed)
  const withoutTrailingSlash = resolved.replace(/[\\/]+$/, "")
  return process.platform === "win32" || looksLikeWindowsPath(trimmed)
    ? withoutTrailingSlash.toLowerCase()
    : withoutTrailingSlash
}

function workspaceTitle(rootPath: string): string {
  const trimmed = rootPath.trim().replace(/[\\/]+$/, "")
  const basename = looksLikeWindowsPath(trimmed)
    ? path.win32.basename(trimmed)
    : path.basename(trimmed)
  return basename || trimmed
}

function looksLikeWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.includes("\\")
}

function normalizeRuntimeCapabilityData(value: unknown): RuntimeCapabilityData {
  const record = getRecord(value) ?? {}
  return {
    discoveredAt: typeof record.discoveredAt === "string"
      ? record.discoveredAt
      : new Date().toISOString(),
    skills: Array.isArray(record.skills) ? record.skills : [],
    mcps: Array.isArray(record.mcps) ? record.mcps : [],
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
    ...(record.cache !== undefined ? { cache: record.cache } : {}),
  }
}

function latestIso(current: string | undefined, next: string): string {
  if (!current) return next
  return Date.parse(next) > Date.parse(current) ? next : current
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function readJsonBody(c: Context): Promise<unknown> {
  const raw = await c.req.text()
  if (raw.trim().length === 0) {
    return {}
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return Symbol("invalid-json")
  }
}

export default runtimeCapabilities
