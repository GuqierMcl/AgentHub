import { execFile } from "node:child_process"
import { arch, platform, release } from "node:os"
import { promisify } from "node:util"
import { resolveRuntimeShell } from "./shell-resolver"
import type { WorkspaceService } from "./workspace"

const execFileAsync = promisify(execFile)
const GIT_STATUS_TIMEOUT_MS = 800
const GIT_STATUS_MAX_BUFFER = 64 * 1024

export type RuntimeEnvironmentGitChanges = {
  modified: number
  added: number
  deleted: number
  renamed: number
  untracked: number
  conflicted: number
}

export type RuntimeEnvironmentGitSnapshot =
  | {
      repository: true
      branch?: string
      dirty: boolean
      ahead?: number
      behind?: number
      changes: RuntimeEnvironmentGitChanges
    }
  | {
      repository: false
      unavailableReason?: string
    }
  | {
      repository: "unknown"
      unavailableReason: string
    }

export type RuntimeEnvironmentSnapshot = {
  capturedAtIso: string
  timezone: string
  os: {
    platform: NodeJS.Platform
    release: string
    arch: string
  }
  workspace:
    | {
        bound: true
        cwd: "."
        workspaceId: string
        backendType: string
        rootLabel: string
        absolutePath: string
      }
    | {
        bound: false
        cwd: "."
      }
  shell: {
    toolName: "bash"
    displayName: string
    commandSyntax: string
  }
  git: RuntimeEnvironmentGitSnapshot
}

export async function buildRuntimeEnvironmentSnapshot(options: {
  workspaceService?: WorkspaceService
  now?: Date
}): Promise<RuntimeEnvironmentSnapshot> {
  const now = options.now ?? new Date()
  const handle = options.workspaceService?.getHandle()
  const shell = resolveRuntimeShell()

  return {
    capturedAtIso: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    os: {
      platform: platform(),
      release: release(),
      arch: arch(),
    },
    workspace: handle
      ? {
          bound: true,
          cwd: ".",
          workspaceId: handle.workspaceId,
          backendType: handle.backendType,
          rootLabel: handle.rootLabel,
          absolutePath: handle.rootPath,
        }
      : {
          bound: false,
          cwd: ".",
        },
    shell: {
      toolName: "bash",
      displayName: shell.displayName,
      commandSyntax: shell.commandSyntax,
    },
    git: handle
      ? await inspectGitStatus(handle.rootPath)
      : {
          repository: false,
          unavailableReason: "workspace_not_bound",
        },
  }
}

export async function inspectGitStatus(workspaceRoot: string): Promise<RuntimeEnvironmentGitSnapshot> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", workspaceRoot, "status", "--porcelain=v1", "--branch"],
      {
        timeout: GIT_STATUS_TIMEOUT_MS,
        maxBuffer: GIT_STATUS_MAX_BUFFER,
        windowsHide: true,
      }
    )
    return parseGitStatus(stdout)
  } catch (error) {
    return mapGitStatusError(error)
  }
}

export function parseGitStatus(stdout: string): RuntimeEnvironmentGitSnapshot {
  const lines = stdout.split(/\r?\n/).filter((line) => line.length > 0)
  const branchLine = lines[0]?.startsWith("## ") ? lines[0] : undefined
  const changeLines = branchLine ? lines.slice(1) : lines
  const changes = createEmptyGitChanges()

  for (const line of changeLines) {
    applyGitStatusLine(changes, line)
  }

  return {
    repository: true,
    branch: branchLine ? parseGitBranch(branchLine) : undefined,
    ...parseAheadBehind(branchLine),
    dirty: changeLines.length > 0,
    changes,
  }
}

export function formatRuntimeEnvironmentSnapshotForPrompt(snapshot: RuntimeEnvironmentSnapshot): string {
  const lines = [
    "Runtime environment snapshot (captured at run start):",
    `- Current time: ${snapshot.capturedAtIso}`,
    `- Timezone: ${snapshot.timezone}`,
    `- Operating system: ${snapshot.os.platform} ${snapshot.os.release} (${snapshot.os.arch})`,
  ]

  if (snapshot.workspace.bound) {
    lines.push(
      `- Workspace cwd: ${snapshot.workspace.cwd}`,
      `- Workspace root label: ${snapshot.workspace.rootLabel}`,
      `- Workspace absolute path: ${snapshot.workspace.absolutePath}`
    )
  } else {
    lines.push("- Workspace: not bound")
  }

  lines.push(
    `- Shell for bash tool: ${snapshot.shell.displayName} (${snapshot.shell.commandSyntax})`,
    `- Git: ${formatGitSnapshot(snapshot.git)}`,
    'Use workspace cwd "." for file and bash tools. The bash tool name is fixed, but command syntax follows the shell above.',
    "Do not mention the workspace absolute path unless it is directly relevant or the user asks for it."
  )

  return lines.join("\n")
}

function createEmptyGitChanges(): RuntimeEnvironmentGitChanges {
  return {
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    untracked: 0,
    conflicted: 0,
  }
}

function applyGitStatusLine(changes: RuntimeEnvironmentGitChanges, line: string): void {
  const status = line.slice(0, 2)
  const indexStatus = status[0] ?? " "
  const worktreeStatus = status[1] ?? " "

  if (status === "??") {
    changes.untracked += 1
    return
  }

  if (isConflictedStatus(indexStatus, worktreeStatus)) {
    changes.conflicted += 1
    return
  }

  if (indexStatus === "M" || worktreeStatus === "M" || indexStatus === "T" || worktreeStatus === "T") {
    changes.modified += 1
  }
  if (indexStatus === "A" || worktreeStatus === "A") {
    changes.added += 1
  }
  if (indexStatus === "D" || worktreeStatus === "D") {
    changes.deleted += 1
  }
  if (indexStatus === "R" || worktreeStatus === "R" || indexStatus === "C" || worktreeStatus === "C") {
    changes.renamed += 1
  }
}

function isConflictedStatus(indexStatus: string, worktreeStatus: string): boolean {
  const status = `${indexStatus}${worktreeStatus}`
  return ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(status)
}

function parseGitBranch(branchLine: string): string | undefined {
  let branch = branchLine.slice("## ".length).trim()
  if (!branch) return undefined
  if (branch.startsWith("No commits yet on ")) {
    branch = branch.slice("No commits yet on ".length)
  }
  branch = branch.split("...")[0]?.trim() ?? branch
  branch = branch.split(" [")[0]?.trim() ?? branch
  return branch || undefined
}

function parseAheadBehind(branchLine: string | undefined): { ahead?: number; behind?: number } {
  if (!branchLine) return {}
  const ahead = branchLine.match(/ahead (\d+)/)?.[1]
  const behind = branchLine.match(/behind (\d+)/)?.[1]
  return {
    ...(ahead ? { ahead: Number.parseInt(ahead, 10) } : {}),
    ...(behind ? { behind: Number.parseInt(behind, 10) } : {}),
  }
}

function mapGitStatusError(error: unknown): RuntimeEnvironmentGitSnapshot {
  const record = typeof error === "object" && error ? error as Record<string, unknown> : {}
  const code = record.code
  const signal = record.signal
  const stderr = typeof record.stderr === "string" ? record.stderr : ""

  if (code === "ENOENT") {
    return { repository: "unknown", unavailableReason: "git_not_found" }
  }
  if (signal === "SIGTERM" || record.killed === true) {
    return { repository: "unknown", unavailableReason: "timeout" }
  }
  if (stderr.includes("not a git repository") || stderr.includes("not a git repo")) {
    return { repository: false, unavailableReason: "not_repository" }
  }
  return { repository: "unknown", unavailableReason: "status_failed" }
}

function formatGitSnapshot(git: RuntimeEnvironmentGitSnapshot): string {
  if (git.repository === false) {
    return git.unavailableReason ? `not a repository (${git.unavailableReason})` : "not a repository"
  }
  if (git.repository === "unknown") {
    return `unknown (${git.unavailableReason})`
  }

  const changeParts = Object.entries(git.changes)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${count} ${key}`)
  const syncParts = [
    typeof git.ahead === "number" ? `ahead ${git.ahead}` : null,
    typeof git.behind === "number" ? `behind ${git.behind}` : null,
  ].filter((part): part is string => Boolean(part))
  return [
    "repository",
    git.branch ? `branch ${git.branch}` : null,
    git.dirty ? "dirty" : "clean",
    changeParts.length > 0 ? `changes: ${changeParts.join(", ")}` : null,
    syncParts.length > 0 ? syncParts.join(", ") : null,
  ].filter((part): part is string => Boolean(part)).join("; ")
}
