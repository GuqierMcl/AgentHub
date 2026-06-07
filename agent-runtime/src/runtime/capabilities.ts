import { existsSync, readdirSync, type Dirent } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import { basename, extname, join, isAbsolute, sep } from "node:path"
import { homedir } from "node:os"
import { z } from "zod"

export const CapabilityScopeSchema = z.enum(["all", "global", "workspace"])
export const CapabilityWorkspaceSchema = z.object({
  workspaceId: z.string().trim().min(1),
  backendType: z.literal("local"),
  rootPath: z.string().trim().min(1),
}).strict()
export const CapabilityDiscoveryRequestSchema = z.object({
  scope: CapabilityScopeSchema.default("all"),
  workspace: CapabilityWorkspaceSchema.optional(),
}).strict()

export type CapabilityScope = z.infer<typeof CapabilityScopeSchema>
export type CapabilityWorkspace = z.infer<typeof CapabilityWorkspaceSchema>
export type CapabilityDiscoveryRequest = z.input<typeof CapabilityDiscoveryRequestSchema>
export type CapabilitySource = "agents" | "codex" | "claude-code" | "opencode"
export type CapabilityLevel = "global" | "workspace"
export type McpTransport = "stdio" | "sse" | "http" | "unknown"

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
}

export type CapabilityDiscoveryServiceOptions = {
  homeDir?: string
  dataDir?: string
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

const SECRET_KEY_PATTERN = /(token|secret|password|passwd|api[-_]?key|authorization|credential)/i
const SECRET_VALUE_PATTERN = /^(sk-|ghp_|github_pat_|xox[baprs]-|ya29\.|eyJ)[A-Za-z0-9._-]{8,}/
const CONFIG_FILE_EXTENSIONS = new Set([".json", ".toml", ".yaml", ".yml"])

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

  constructor(options: CapabilityDiscoveryServiceOptions = {}) {
    this.homeDir = options.homeDir ?? process.env.USERPROFILE ?? homedir()
    this.dataDir = options.dataDir ?? join(process.cwd(), "data-tmp")
  }

  async discover(input: CapabilityDiscoveryRequest = {}): Promise<CapabilityDiscoveryResponse> {
    const request = CapabilityDiscoveryRequestSchema.parse(input)
    if ((request.scope === "workspace" || request.scope === "all") && !request.workspace) {
      throw new CapabilityDiscoveryError(
        "CAPABILITY_WORKSPACE_REQUIRED",
        "Workspace discovery requires an explicit workspace snapshot.",
      )
    }

    const warnings: string[] = []
    const skills: SkillCapabilitySummary[] = []
    const mcps: McpServerCapabilitySummary[] = []

    if (request.scope === "global" || request.scope === "all") {
      skills.push(...await this.discoverSkills(this.globalSkillRoots()))
      mcps.push(...await this.discoverMcpServers(this.globalMcpCandidates()))
    }

    if ((request.scope === "workspace" || request.scope === "all") && request.workspace) {
      const workspaceRoot = request.workspace.rootPath
      skills.push(...await this.discoverSkills(this.workspaceSkillRoots(workspaceRoot)))
      mcps.push(...await this.discoverMcpServers(this.workspaceMcpCandidates(workspaceRoot)))
    }

    return {
      discoveredAt: new Date().toISOString(),
      scope: request.scope,
      skills: sortById(skills),
      mcps: sortById(mcps),
      warnings,
    }
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

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id))
}
