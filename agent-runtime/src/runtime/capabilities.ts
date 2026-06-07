import { existsSync, readdirSync, type Dirent } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import { basename, extname, join, isAbsolute, sep } from "node:path"
import { homedir } from "node:os"
import { createHash } from "node:crypto"
import { z } from "zod"

export const CapabilitySourceSchema = z.enum(["agents", "codex", "claude-code", "opencode"])
export const CapabilityScopeSchema = z.enum(["all", "global", "workspace"])
export const CapabilityWorkspaceSchema = z.object({
  workspaceId: z.string().trim().min(1),
  backendType: z.literal("local"),
  rootPath: z.string().trim().min(1),
}).strict()
export const CapabilityDiscoveryRequestSchema = z.object({
  scope: CapabilityScopeSchema.default("all"),
  workspace: CapabilityWorkspaceSchema.optional(),
  sources: z.array(CapabilitySourceSchema).min(1).optional(),
}).strict()

export type CapabilityScope = z.infer<typeof CapabilityScopeSchema>
export type CapabilityWorkspace = z.infer<typeof CapabilityWorkspaceSchema>
export type CapabilityDiscoveryRequest = z.input<typeof CapabilityDiscoveryRequestSchema>
export type CapabilitySource = z.infer<typeof CapabilitySourceSchema>
export type CapabilityLevel = "global" | "workspace"
export type McpTransport = "stdio" | "sse" | "http" | "unknown"
export type CapabilityDiscoveryRuntimeStatus = "idle" | "refreshing" | "error"

export type CapabilityCacheMetadata = {
  hit: boolean
  refreshed: boolean
  cacheKey: string
  expiresAt: string
  fingerprint: string
}

export type SkillCapabilitySummary = {
  id: string
  name: string
  source: CapabilitySource
  level: CapabilityLevel
  path: string
  description?: string
  valid: boolean
  warnings: string[]
}

export type SkillCapabilityLookup = SkillCapabilitySummary & {
  filePath: string
}

export type McpServerCapabilitySummary = {
  id: string
  name: string
  source: CapabilitySource
  level: CapabilityLevel
  configPath: string
  transport?: McpTransport
  command?: string
  args?: string[]
  valid: boolean
  warnings: string[]
}

export type CapabilityDiscoveryResponse = {
  discoveredAt: string
  scope: CapabilityScope
  skills: SkillCapabilitySummary[]
  mcps: McpServerCapabilitySummary[]
  warnings: string[]
  cache?: CapabilityCacheMetadata
}

export type CapabilityDiscoveryStatusItem = {
  id: "capability-discovery"
  label: "Capability Discovery"
  kind: "runtime-capability"
  status: CapabilityDiscoveryRuntimeStatus
  implemented: true
  checkedAt: string
  details: {
    cacheEntryCount: number
    latestRefreshAt?: string
    latestError?: string
    lastRefreshDurationMs?: number
  }
}

export type CapabilityDiscoveryServiceOptions = {
  homeDir?: string
  dataDir?: string
  cacheTtlMs?: number
}

type SkillRoot = {
  source: CapabilitySource
  level: CapabilityLevel
  directory: string
  refPrefix: string
}

type StringDirent = Dirent<string>

type McpConfigCandidate = {
  source: CapabilitySource
  level: CapabilityLevel
  filePath: string
  ref: string
}

type McpServerRecord = {
  name: string
  value: Record<string, unknown>
}

type NormalizedCapabilityDiscoveryRequest = z.infer<typeof CapabilityDiscoveryRequestSchema>

type CapabilityCacheEntry = {
  response: Omit<CapabilityDiscoveryResponse, "cache">
  fingerprint: string
  expiresAtMs: number
}

const SECRET_KEY_PATTERN = /(token|secret|password|passwd|api[-_]?key|authorization|credential)/i
const SECRET_VALUE_PATTERN = /^(sk-|ghp_|github_pat_|xox[baprs]-|ya29\.|eyJ)[A-Za-z0-9._-]{8,}/
const CONFIG_FILE_EXTENSIONS = new Set([".json", ".toml", ".yaml", ".yml"])
const DEFAULT_CAPABILITY_CACHE_TTL_MS = 30_000

export class CapabilityDiscoveryError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message)
    this.name = "CapabilityDiscoveryError"
  }
}

export class CapabilityDiscoveryService {
  private homeDir: string
  private dataDir: string
  private cacheTtlMs: number
  private cache = new Map<string, CapabilityCacheEntry>()
  private status: CapabilityDiscoveryRuntimeStatus = "idle"
  private latestRefreshAt: string | undefined
  private latestError: string | undefined
  private lastRefreshDurationMs: number | undefined

  constructor(options: CapabilityDiscoveryServiceOptions = {}) {
    this.homeDir = options.homeDir ?? process.env.USERPROFILE ?? homedir()
    this.dataDir = options.dataDir ?? join(process.cwd(), "data-tmp")
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CAPABILITY_CACHE_TTL_MS
  }

  async discover(input: CapabilityDiscoveryRequest = {}): Promise<CapabilityDiscoveryResponse> {
    const request = CapabilityDiscoveryRequestSchema.parse(input)
    return this.discoverWithCache(request, { forceRefresh: false })
  }

  async refresh(input: CapabilityDiscoveryRequest = {}): Promise<CapabilityDiscoveryResponse> {
    const request = CapabilityDiscoveryRequestSchema.parse(input)
    return this.discoverWithCache(request, { forceRefresh: true })
  }

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

  getStatus(checkedAt = new Date().toISOString()): CapabilityDiscoveryStatusItem {
    return {
      id: "capability-discovery",
      label: "Capability Discovery",
      kind: "runtime-capability",
      status: this.status,
      implemented: true,
      checkedAt,
      details: {
        cacheEntryCount: this.cache.size,
        ...(this.latestRefreshAt ? { latestRefreshAt: this.latestRefreshAt } : {}),
        ...(this.latestError ? { latestError: this.latestError } : {}),
        ...(this.lastRefreshDurationMs !== undefined ? { lastRefreshDurationMs: this.lastRefreshDurationMs } : {}),
      },
    }
  }

  private async discoverWithCache(
    request: NormalizedCapabilityDiscoveryRequest,
    options: { forceRefresh: boolean },
  ): Promise<CapabilityDiscoveryResponse> {
    if ((request.scope === "workspace" || request.scope === "all") && !request.workspace) {
      throw new CapabilityDiscoveryError(
        "CAPABILITY_WORKSPACE_REQUIRED",
        "Workspace discovery requires an explicit workspace snapshot.",
      )
    }

    const cacheKey = createCacheKey(request)
    const fingerprint = await this.createFingerprint(request)
    const now = Date.now()
    const cached = this.cache.get(cacheKey)
    if (
      cached &&
      !options.forceRefresh &&
      cached.fingerprint === fingerprint &&
      cached.expiresAtMs > now
    ) {
      return {
        ...cached.response,
        cache: {
          hit: true,
          refreshed: false,
          cacheKey,
          expiresAt: new Date(cached.expiresAtMs).toISOString(),
          fingerprint,
        },
      }
    }

    const startedAt = Date.now()
    this.status = "refreshing"
    try {
      const response = await this.performDiscovery(request)
      const expiresAtMs = Date.now() + this.cacheTtlMs
      this.cache.set(cacheKey, {
        response,
        fingerprint,
        expiresAtMs,
      })
      this.latestRefreshAt = new Date().toISOString()
      this.latestError = undefined
      this.lastRefreshDurationMs = Date.now() - startedAt
      this.status = "idle"
      return {
        ...response,
        cache: {
          hit: false,
          refreshed: true,
          cacheKey,
          expiresAt: new Date(expiresAtMs).toISOString(),
          fingerprint,
        },
      }
    } catch (error) {
      this.latestError = sanitizeStatusError(error instanceof Error ? error.message : "Capability discovery failed")
      this.lastRefreshDurationMs = Date.now() - startedAt
      this.status = "error"
      throw error
    }
  }

  private async performDiscovery(request: NormalizedCapabilityDiscoveryRequest): Promise<Omit<CapabilityDiscoveryResponse, "cache">> {
    const warnings: string[] = []
    const skills: SkillCapabilitySummary[] = []
    const mcps: McpServerCapabilitySummary[] = []

    if (request.scope === "global" || request.scope === "all") {
      skills.push(...await this.discoverSkills(this.filterSkillRoots(this.globalSkillRoots(), request.sources)))
      mcps.push(...await this.discoverMcpServers(this.filterMcpCandidates(this.globalMcpCandidates(), request.sources)))
    }

    if ((request.scope === "workspace" || request.scope === "all") && request.workspace) {
      const workspaceRoot = request.workspace.rootPath
      skills.push(...await this.discoverSkills(this.filterSkillRoots(this.workspaceSkillRoots(workspaceRoot), request.sources)))
      mcps.push(...await this.discoverMcpServers(this.filterMcpCandidates(this.workspaceMcpCandidates(workspaceRoot), request.sources)))
    }

    return {
      discoveredAt: new Date().toISOString(),
      scope: request.scope,
      skills: sortById(skills),
      mcps: sortById(mcps),
      warnings,
    }
  }

  private async createFingerprint(request: NormalizedCapabilityDiscoveryRequest): Promise<string> {
    const parts: string[] = [
      `scope:${request.scope}`,
      `sources:${normalizeSources(request.sources).join(",")}`,
      request.workspace
        ? `workspace:${request.workspace.workspaceId}:${hashValue(request.workspace.rootPath)}`
        : "workspace:none",
    ]

    const skillRoots: SkillRoot[] = []
    const mcpCandidates: McpConfigCandidate[] = []
    if (request.scope === "global" || request.scope === "all") {
      skillRoots.push(...this.filterSkillRoots(this.globalSkillRoots(), request.sources))
      mcpCandidates.push(...this.filterMcpCandidates(this.globalMcpCandidates(), request.sources))
    }
    if ((request.scope === "workspace" || request.scope === "all") && request.workspace) {
      skillRoots.push(...this.filterSkillRoots(this.workspaceSkillRoots(request.workspace.rootPath), request.sources))
      mcpCandidates.push(...this.filterMcpCandidates(this.workspaceMcpCandidates(request.workspace.rootPath), request.sources))
    }

    for (const root of skillRoots) {
      parts.push(...await fingerprintSkillRoot(root))
    }
    for (const candidate of mcpCandidates) {
      parts.push(...await fingerprintFile(candidate.ref, candidate.filePath))
    }

    return hashValue(parts.sort().join("|"))
  }

  private filterSkillRoots(roots: SkillRoot[], sources?: CapabilitySource[]): SkillRoot[] {
    const allowed = sources ? new Set(sources) : null
    return allowed ? roots.filter((root) => allowed.has(root.source)) : roots
  }

  private filterMcpCandidates(candidates: McpConfigCandidate[], sources?: CapabilitySource[]): McpConfigCandidate[] {
    const allowed = sources ? new Set(sources) : null
    return allowed ? candidates.filter((candidate) => allowed.has(candidate.source)) : candidates
  }

  private globalSkillRoots(): SkillRoot[] {
    return [
      skillRoot("agents", "global", join(this.homeDir, ".agents", "skills"), "global:agents"),
      skillRoot("codex", "global", join(this.homeDir, ".codex", "skills"), "global:codex"),
      skillRoot("codex", "global", join(this.homeDir, ".codex", "skills", ".system"), "global:codex:.system"),
      skillRoot("claude-code", "global", join(this.homeDir, ".claude", "skills"), "global:claude-code"),
      skillRoot("opencode", "global", join(this.homeDir, ".config", "opencode", "skills"), "global:opencode:config"),
      skillRoot("opencode", "global", join(this.homeDir, ".opencode", "skills"), "global:opencode"),
    ]
  }

  private workspaceSkillRoots(rootPath: string): SkillRoot[] {
    return [
      skillRoot("agents", "workspace", join(rootPath, ".agents", "skills"), "workspace:agents"),
      skillRoot("codex", "workspace", join(rootPath, ".codex", "skills"), "workspace:codex"),
      skillRoot("claude-code", "workspace", join(rootPath, ".claude", "skills"), "workspace:claude-code"),
      skillRoot("opencode", "workspace", join(rootPath, ".opencode", "skills"), "workspace:opencode"),
    ]
  }

  private globalMcpCandidates(): McpConfigCandidate[] {
    return [
      ...mcpFiles("agents", "global", join(this.homeDir, ".agents"), "global:agents"),
      ...mcpDirectoryFiles("agents", "global", join(this.homeDir, ".agents", "mcp"), "global:agents:mcp"),
      ...mcpFiles("codex", "global", join(this.homeDir, ".codex"), "global:codex"),
      ...mcpDirectoryFiles("codex", "global", join(this.homeDir, ".codex", "mcp"), "global:codex:mcp"),
      mcpFile("claude-code", "global", join(this.homeDir, ".claude.json"), "global:claude-code:.claude.json"),
      ...mcpFiles("claude-code", "global", join(this.homeDir, ".claude"), "global:claude-code"),
      ...mcpFiles("opencode", "global", join(this.homeDir, ".config", "opencode"), "global:opencode:config"),
      ...mcpFiles("opencode", "global", join(this.homeDir, ".opencode"), "global:opencode"),
      ...mcpFiles("agents", "global", this.dataDir, "global:agents:data-dir"),
    ]
  }

  private workspaceMcpCandidates(rootPath: string): McpConfigCandidate[] {
    return [
      ...mcpFiles("agents", "workspace", join(rootPath, ".agents"), "workspace:agents"),
      ...mcpDirectoryFiles("agents", "workspace", join(rootPath, ".agents", "mcp"), "workspace:agents:mcp"),
      ...mcpFiles("codex", "workspace", join(rootPath, ".codex"), "workspace:codex"),
      ...mcpDirectoryFiles("codex", "workspace", join(rootPath, ".codex", "mcp"), "workspace:codex:mcp"),
      mcpFile("claude-code", "workspace", join(rootPath, ".mcp.json"), "workspace:claude-code:.mcp.json"),
      ...mcpFiles("claude-code", "workspace", join(rootPath, ".claude"), "workspace:claude-code"),
      ...mcpFiles("opencode", "workspace", join(rootPath, ".opencode"), "workspace:opencode"),
    ]
  }

  private async discoverSkills(roots: SkillRoot[]): Promise<SkillCapabilitySummary[]> {
    const items: SkillCapabilitySummary[] = []
    for (const root of roots) {
      if (!existsSync(root.directory)) continue

      let entries: StringDirent[]
      try {
        entries = await readdir(root.directory, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const skillName = entry.name
        const skillFile = join(root.directory, skillName, "SKILL.md")
        if (!existsSync(skillFile)) continue
        items.push(await this.readSkill(root, skillName, skillFile))
      }
    }
    return items
  }

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

  private async readSkill(root: SkillRoot, fallbackName: string, skillFile: string): Promise<SkillCapabilitySummary> {
    const warnings: string[] = []
    let frontmatter: Record<string, unknown> = {}

    try {
      const content = await readFile(skillFile, "utf-8")
      const parsed = parseFrontmatter(content)
      frontmatter = parsed.data
      warnings.push(...parsed.warnings)
    } catch {
      warnings.push("Unable to read SKILL.md.")
    }

    const name = getString(frontmatter.name) ?? fallbackName
    const description = getString(frontmatter.description)
    const ref = `${root.refPrefix}:${fallbackName}`
    return {
      id: stableId(ref),
      name,
      source: root.source,
      level: root.level,
      path: ref,
      ...(description ? { description } : {}),
      valid: warnings.length === 0,
      warnings,
    }
  }

  private async discoverMcpServers(candidates: McpConfigCandidate[]): Promise<McpServerCapabilitySummary[]> {
    const items: McpServerCapabilitySummary[] = []
    for (const candidate of candidates) {
      if (!existsSync(candidate.filePath)) continue
      let fileStat: Awaited<ReturnType<typeof stat>>
      try {
        fileStat = await stat(candidate.filePath)
      } catch {
        continue
      }
      if (!fileStat.isFile()) continue
      items.push(...await this.readMcpConfig(candidate))
    }
    return items
  }

  private async readMcpConfig(candidate: McpConfigCandidate): Promise<McpServerCapabilitySummary[]> {
    let parsed: unknown
    try {
      const content = await readFile(candidate.filePath, "utf-8")
      parsed = parseConfig(candidate.filePath, content)
    } catch {
      return [invalidMcp(candidate, basename(candidate.ref), "Unable to parse MCP config.")]
    }

    const servers = extractMcpServers(parsed)
    if (servers.length === 0) return []

    return servers.map((server) => {
      const transport = inferTransport(server.value)
      const command = sanitizeCommand(getString(server.value.command))
      const args = sanitizeArgs(getStringArray(server.value.args))
      const ref = `${candidate.ref}:${server.name}`
      return {
        id: stableId(ref),
        name: server.name,
        source: candidate.source,
        level: candidate.level,
        configPath: candidate.ref,
        transport,
        ...(command ? { command } : {}),
        ...(args.length > 0 ? { args } : {}),
        valid: true,
        warnings: [],
      }
    })
  }
}

function skillRoot(
  source: CapabilitySource,
  level: CapabilityLevel,
  directory: string,
  refPrefix: string,
): SkillRoot {
  return { source, level, directory, refPrefix }
}

function mcpFiles(
  source: CapabilitySource,
  level: CapabilityLevel,
  directory: string,
  refPrefix: string,
): McpConfigCandidate[] {
  return [
    mcpFile(source, level, join(directory, "mcp.json"), `${refPrefix}:mcp.json`),
    mcpFile(source, level, join(directory, "mcp.yaml"), `${refPrefix}:mcp.yaml`),
    mcpFile(source, level, join(directory, "mcp.yml"), `${refPrefix}:mcp.yml`),
    mcpFile(source, level, join(directory, "mcp.toml"), `${refPrefix}:mcp.toml`),
    mcpFile(source, level, join(directory, "config.toml"), `${refPrefix}:config.toml`),
    mcpFile(source, level, join(directory, "config.json"), `${refPrefix}:config.json`),
    mcpFile(source, level, join(directory, "opencode.json"), `${refPrefix}:opencode.json`),
    mcpFile(source, level, join(directory, "opencode.yaml"), `${refPrefix}:opencode.yaml`),
    mcpFile(source, level, join(directory, "opencode.yml"), `${refPrefix}:opencode.yml`),
  ]
}

function mcpDirectoryFiles(
  source: CapabilitySource,
  level: CapabilityLevel,
  directory: string,
  refPrefix: string,
): McpConfigCandidate[] {
  if (!existsSync(directory)) return []
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry: StringDirent) => entry.isFile() && CONFIG_FILE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      .map((entry: StringDirent) => mcpFile(source, level, join(directory, entry.name), `${refPrefix}:${entry.name}`))
  } catch {
    return []
  }
}

function mcpFile(
  source: CapabilitySource,
  level: CapabilityLevel,
  filePath: string,
  ref: string,
): McpConfigCandidate {
  return { source, level, filePath, ref }
}

function parseFrontmatter(content: string): { data: Record<string, unknown>; warnings: string[] } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return { data: {}, warnings: [] }

  try {
    const data = Bun.YAML.parse(match[1] ?? "")
    return {
      data: isRecord(data) ? data : {},
      warnings: isRecord(data) ? [] : ["Skill frontmatter must be an object."],
    }
  } catch {
    return {
      data: {},
      warnings: ["Unable to parse Skill frontmatter."],
    }
  }
}

function parseConfig(filePath: string, content: string): unknown {
  const ext = extname(filePath).toLowerCase()
  if (ext === ".toml") return Bun.TOML.parse(content)
  if (ext === ".yaml" || ext === ".yml") return Bun.YAML.parse(content)
  return JSON.parse(content)
}

function extractMcpServers(value: unknown): McpServerRecord[] {
  const root = isRecord(value) ? value : {}
  const candidates = [
    root.mcpServers,
    root.mcp_servers,
    getRecord(root.mcp)?.servers,
    getRecord(root.mcp)?.mcpServers,
    getRecord(root.mcp)?.mcp_servers,
  ]

  const result: McpServerRecord[] = []
  for (const candidate of candidates) {
    result.push(...extractNamedServerMap(candidate))
  }
  return dedupeServers(result)
}

function extractNamedServerMap(value: unknown): McpServerRecord[] {
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([name, config]) => {
    if (!isRecord(config)) return []
    return [{ name, value: config }]
  })
}

function dedupeServers(servers: McpServerRecord[]): McpServerRecord[] {
  const seen = new Set<string>()
  const result: McpServerRecord[] = []
  for (const server of servers) {
    if (seen.has(server.name)) continue
    seen.add(server.name)
    result.push(server)
  }
  return result
}

function invalidMcp(
  candidate: McpConfigCandidate,
  name: string,
  warning: string,
): McpServerCapabilitySummary {
  const ref = `${candidate.ref}:invalid`
  return {
    id: stableId(ref),
    name,
    source: candidate.source,
    level: candidate.level,
    configPath: candidate.ref,
    transport: "unknown",
    valid: false,
    warnings: [warning],
  }
}

function inferTransport(server: Record<string, unknown>): McpTransport {
  const transport = getString(server.transport)?.toLowerCase()
  if (transport === "stdio" || transport === "sse" || transport === "http") return transport
  if (getString(server.command)) return "stdio"
  const url = getString(server.url)
  if (url?.startsWith("http://") || url?.startsWith("https://")) return "http"
  return "unknown"
}

async function fingerprintSkillRoot(root: SkillRoot): Promise<string[]> {
  const parts: string[] = []
  parts.push(...await fingerprintFile(`${root.refPrefix}:directory`, root.directory))
  if (!existsSync(root.directory)) return parts

  let entries: StringDirent[]
  try {
    entries = await readdir(root.directory, { withFileTypes: true })
  } catch {
    return parts
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillFile = join(root.directory, entry.name, "SKILL.md")
    parts.push(...await fingerprintFile(`${root.refPrefix}:${entry.name}`, skillFile))
  }
  return parts
}

async function fingerprintFile(ref: string, path: string): Promise<string[]> {
  try {
    const fileStat = await stat(path)
    return [`${ref}:${fileStat.isDirectory() ? "dir" : "file"}:${fileStat.mtimeMs}:${fileStat.size}`]
  } catch {
    return [`${ref}:missing`]
  }
}

function createCacheKey(request: NormalizedCapabilityDiscoveryRequest): string {
  return stableId([
    request.scope,
    normalizeSources(request.sources).join("."),
    request.workspace
      ? `${request.workspace.workspaceId}.${hashValue(request.workspace.rootPath).slice(0, 12)}`
      : "global",
  ].join(":"))
}

function normalizeSources(sources?: CapabilitySource[]): CapabilitySource[] {
  return sources?.length
    ? [...new Set(sources)].sort()
    : ["agents", "claude-code", "codex", "opencode"]
}

function sanitizeCommand(command: string | undefined): string | undefined {
  if (!command) return undefined
  if (isAbsolute(command) || command.includes(sep)) return basename(command)
  return command
}

function sanitizeArgs(args: string[]): string[] {
  let redactNext = false
  return args.map((arg) => {
    if (redactNext) {
      redactNext = false
      return "[REDACTED]"
    }

    if (SECRET_KEY_PATTERN.test(arg)) {
      if (arg.includes("=")) {
        return `${arg.slice(0, arg.indexOf("=") + 1)}[REDACTED]`
      }
      redactNext = true
      return arg
    }

    if (SECRET_VALUE_PATTERN.test(arg) || isAbsolute(arg)) {
      return "[REDACTED]"
    }

    return arg
  })
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stableId(value: string): string {
  return value.replace(/[^a-zA-Z0-9:._-]+/g, "-")
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex")
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

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id))
}
