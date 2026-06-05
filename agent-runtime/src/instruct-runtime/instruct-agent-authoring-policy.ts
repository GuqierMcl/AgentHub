import type { AgentPermissionPolicy, AgentToolPermissionRules } from "../agents"
import { DEFAULT_USER_AGENT_PERMISSION_POLICY } from "../agents"

const INSTRUCT_SAVE_AGENT_ALLOWED_TOOLS = [
  "ls",
  "read_file",
  "glob",
  "grep",
  "write_file",
  "edit_file",
] as const

export const INSTRUCT_SAVE_AGENT_TOOL_WHITELIST: ReadonlySet<string> = new Set(
  INSTRUCT_SAVE_AGENT_ALLOWED_TOOLS
)

export const INSTRUCT_SYSTEM_PRESET_IDS: ReadonlySet<string> = new Set([
  "orchestrator",
  "coder",
  "reviewer",
  "writer",
  "planner",
  "opencode",
  "explore",
  "general",
  "file",
  "deploy",
  "instruct-agent",
])

const IMPLICIT_INSTRUCT_TOOLS = ["question"] as const

const FILESYSTEM_PERMISSION_RANK = {
  none: 0,
  read: 1,
  write: 2,
} as const

const TOOL_FILESYSTEM_REQUIRED: Record<string, AgentPermissionPolicy["filesystem"]> = {
  ls: "read",
  read_file: "read",
  glob: "read",
  grep: "read",
  write_file: "write",
  edit_file: "write",
}

export class InstructPermissionError extends Error {
  constructor(
    public code: "AGENT_INVALID_INPUT" | "AGENT_ALREADY_EXISTS" | "AGENT_STORE_WRITE_FAILED",
    message: string,
    public status: 400 | 409 | 500,
    public details?: unknown
  ) {
    super(message)
    this.name = "InstructPermissionError"
  }
}

function normalizeStringList(values: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }

    seen.add(trimmed)
    normalized.push(trimmed)
  }

  return normalized
}

export function normalizeAllowedToolsForInstruct(toolNames: string[]): string[] {
  const implicitToolSet = new Set<string>(IMPLICIT_INSTRUCT_TOOLS)
  const normalized = normalizeStringList(toolNames)
    .filter((toolName) => !implicitToolSet.has(toolName))

  for (const toolName of normalized) {
    if (!INSTRUCT_SAVE_AGENT_TOOL_WHITELIST.has(toolName)) {
      throw new InstructPermissionError(
        "AGENT_INVALID_INPUT",
        `Tool ${toolName} is not available for user agents created via instruct`,
        400,
        {
          field: "allowedTools",
          toolName,
          allowedTools: Array.from(INSTRUCT_SAVE_AGENT_TOOL_WHITELIST),
        }
      )
    }
  }

  return normalized
}

export function normalizePermissionPolicyForInstructAgent(
  policy: AgentPermissionPolicy | undefined,
  allowedTools: string[]
): AgentPermissionPolicy {
  const normalized: AgentPermissionPolicy = {
    filesystem: policy?.filesystem ?? DEFAULT_USER_AGENT_PERMISSION_POLICY.filesystem,
    shell: policy?.shell ?? DEFAULT_USER_AGENT_PERMISSION_POLICY.shell,
    network: policy?.network ?? DEFAULT_USER_AGENT_PERMISSION_POLICY.network,
    deploy: policy?.deploy ?? DEFAULT_USER_AGENT_PERMISSION_POLICY.deploy,
  }

  const violations: Array<{ path: string[]; message: string }> = []

  const requiredFilesystem = allowedTools
    .map((toolId) => TOOL_FILESYSTEM_REQUIRED[toolId])
    .filter((v): v is NonNullable<typeof v> => Boolean(v))
    .sort((left, right) => FILESYSTEM_PERMISSION_RANK[right] - FILESYSTEM_PERMISSION_RANK[left])[0]

  if (
    requiredFilesystem &&
    FILESYSTEM_PERMISSION_RANK[normalized.filesystem] < FILESYSTEM_PERMISSION_RANK[requiredFilesystem]
  ) {
    violations.push({
      path: ["permissionPolicy", "filesystem"],
      message: `Selected tools require filesystem ${requiredFilesystem} permission`,
    })
  }

  if (normalized.shell !== "none") {
    violations.push({
      path: ["permissionPolicy", "shell"],
      message: "User agents cannot request shell permission in this version",
    })
  }

  if (normalized.network !== "none") {
    violations.push({
      path: ["permissionPolicy", "network"],
      message: "User agents cannot request network permission in this version",
    })
  }

  if (normalized.deploy !== "none") {
    violations.push({
      path: ["permissionPolicy", "deploy"],
      message: "User agents cannot request deploy permission in this version",
    })
  }

  if (violations.length > 0) {
    throw new InstructPermissionError(
      "AGENT_INVALID_INPUT",
      "Invalid user agent permission policy",
      400,
      violations
    )
  }

  return normalized
}

export function normalizeUserToolPermissionRules(
  rules: AgentToolPermissionRules | undefined
): AgentToolPermissionRules | undefined {
  if (!rules) {
    return undefined
  }

  if (rules.bash && Object.keys(rules.bash).length > 0) {
    throw new InstructPermissionError(
      "AGENT_INVALID_INPUT",
      "User agents cannot configure bash permission rules in this version",
      400,
      [{
        path: ["toolPermissionRules", "bash"],
        message: "User agents cannot configure bash permission rules in this version",
      }]
    )
  }

  return undefined
}
