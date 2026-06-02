import { execFile } from "node:child_process"
import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { createChildLogger } from "../logger"
import type {
  RunWorkspaceSummary,
  WorkspaceDiffFile,
  WorkspaceDiffFileOrigin,
  WorkspaceDiffPatch,
  WorkspaceDiffSnapshot,
  WorkspaceDiffStats,
  WorkspaceDiffSummary,
} from "./types"
import type { WorkspaceService } from "./workspace"

const execFileAsync = promisify(execFile)
const log = createChildLogger("workspace-diff")

const GIT_TIMEOUT_MS = 1500
const GIT_MAX_BUFFER_BYTES = 1024 * 1024
const PATCH_MAX_BYTES = 200 * 1024

type GitCommandOptions = {
  timeoutMs?: number
  maxBufferBytes?: number
  allowFailure?: boolean
}

export type GitCommandRunner = (
  workspaceRoot: string,
  args: string[],
  options?: GitCommandOptions
) => Promise<{ stdout: string; stderr: string; exitCode: number }>

type GitStatusEntry = {
  path: string
  status: string
}

type GitNumstatEntry = {
  path: string
  additions?: number
  deletions?: number
  binary?: boolean
}

type GitSnapshotResult = {
  snapshot: WorkspaceDiffSnapshot
  statusByPath: Map<string, string>
  fingerprintByPath: Map<string, string>
  degradedReasons: string[]
}

export type WorkspaceDiffBaseline = {
  workspace?: RunWorkspaceSummary
  rootPath?: string
  snapshot: WorkspaceDiffSnapshot
  statusByPath: Map<string, string>
  fingerprintByPath: Map<string, string>
  degradedReasons: string[]
}

export class WorkspaceDiffService {
  constructor(private dependencies: {
    runGit?: GitCommandRunner
    now?: () => Date
  } = {}) {}

  async captureBaseline(workspaceService?: WorkspaceService): Promise<WorkspaceDiffBaseline> {
    const handle = workspaceService?.getHandle()
    if (!handle) {
      const snapshot = this.createUnavailableSnapshot("workspace_not_bound")
      return {
        snapshot,
        statusByPath: new Map(),
        fingerprintByPath: new Map(),
        degradedReasons: ["workspace_not_bound"],
      }
    }

    try {
      const result = await this.readGitSnapshot(handle.rootPath)
      log.debug({
        workspaceId: handle.workspaceId,
        repository: result.snapshot.repository,
        dirty: result.snapshot.dirty,
        fileCount: result.snapshot.fileCount,
        unavailableReason: result.snapshot.unavailableReason,
      }, "Workspace diff baseline captured")
      return {
        workspace: {
          workspaceId: handle.workspaceId,
          backendType: "local",
          rootLabel: handle.rootLabel,
        },
        rootPath: handle.rootPath,
        snapshot: result.snapshot,
        statusByPath: result.statusByPath,
        fingerprintByPath: result.fingerprintByPath,
        degradedReasons: result.degradedReasons,
      }
    } catch (error) {
      const mapped = mapGitError(error)
      log.warn({
        workspaceId: handle.workspaceId,
        reason: mapped.code,
        message: mapped.message,
      }, "Workspace diff baseline unavailable")
      return {
        workspace: {
          workspaceId: handle.workspaceId,
          backendType: "local",
          rootLabel: handle.rootLabel,
        },
        rootPath: handle.rootPath,
        snapshot: this.createUnavailableSnapshot(mapped.code),
        statusByPath: new Map(),
        fingerprintByPath: new Map(),
        degradedReasons: [mapped.code],
      }
    }
  }

  async summarize(
    workspaceService?: WorkspaceService,
    baseline?: WorkspaceDiffBaseline
  ): Promise<WorkspaceDiffSummary> {
    const effectiveBaseline = baseline ?? await this.captureBaseline(workspaceService)
    const handle = workspaceService?.getHandle()
    const workspace = effectiveBaseline.workspace ?? (
      handle
        ? {
            workspaceId: handle.workspaceId,
            backendType: "local" as const,
            rootLabel: handle.rootLabel,
          }
        : undefined
    )
    const rootPath = effectiveBaseline.rootPath ?? handle?.rootPath

    if (!rootPath) {
      return this.createUnavailableSummary(
        workspace,
        effectiveBaseline.snapshot,
        this.createUnavailableSnapshot("workspace_not_bound"),
        "workspace_not_bound",
        "Workspace is not bound for this run"
      )
    }

    let finalResult: GitSnapshotResult
    try {
      finalResult = await this.readGitSnapshot(rootPath)
    } catch (error) {
      const mapped = mapGitError(error)
      return this.createUnavailableSummary(
        workspace,
        effectiveBaseline.snapshot,
        this.createUnavailableSnapshot(mapped.code),
        mapped.code,
        mapped.message
      )
    }

    const baselineDirty = effectiveBaseline.snapshot.dirty
    const limitations = uniqueStrings([
      ...effectiveBaseline.degradedReasons,
      ...finalResult.degradedReasons,
      ...(baselineDirty
        ? ["baseline_dirty_final_diff_is_not_precise_run_only"]
        : []),
    ])
    const changedFiles = buildChangedFiles(
      effectiveBaseline.statusByPath,
      finalResult.statusByPath,
      effectiveBaseline.fingerprintByPath,
      finalResult.fingerprintByPath,
      baselineDirty
    )
    const numstat = finalResult.snapshot.repository === "available"
      ? await this.readNumstat(rootPath, limitations)
      : new Map<string, GitNumstatEntry>()
    applyNumstat(changedFiles, numstat)
    await applyMissingLineStats(rootPath, changedFiles, limitations)
    const stats = buildStats(changedFiles)
    const patch = finalResult.snapshot.repository === "available"
      ? await this.readPatch(rootPath, limitations)
      : undefined

    const status = finalResult.snapshot.repository === "available"
      ? limitations.length > 0 ? "degraded" : "available"
      : "unavailable"
    const summary = formatWorkspaceDiffSummary(changedFiles, stats, {
      baselineDirty,
      status,
      unavailableReason: finalResult.snapshot.unavailableReason,
    })

    return {
      version: 1,
      status,
      source: "git",
      ...(workspace ? { workspace } : {}),
      baseline: effectiveBaseline.snapshot,
      final: finalResult.snapshot,
      baselineDirty,
      runOnlyReliable: !baselineDirty && status === "available",
      changedFiles,
      stats,
      ...(patch ? { patch } : {}),
      summary,
      limitations,
      ...(status === "unavailable"
        ? {
            error: {
              code: finalResult.snapshot.unavailableReason ?? "workspace_diff_unavailable",
              message: summary,
            },
          }
        : {}),
    }
  }

  private async readGitSnapshot(workspaceRoot: string): Promise<GitSnapshotResult> {
    const statusResult = await this.runGit(workspaceRoot, [
      "status",
      "--porcelain=v1",
      "-z",
      "--branch",
      "--",
      ".",
    ])
    const statusEntries = parseGitStatusPorcelainZ(statusResult.stdout)
    const statusByPath = new Map(statusEntries.map((entry) => [entry.path, entry.status]))
    const degradedReasons: string[] = []
    const fingerprintByPath = await this.readStatusFingerprints(
      workspaceRoot,
      statusEntries,
      degradedReasons
    )
    const head = await this.readOptionalGitValue(workspaceRoot, [
      "rev-parse",
      "--verify",
      "HEAD",
    ], "head_unavailable", degradedReasons)
    const branch = await this.readOptionalGitValue(workspaceRoot, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ], "branch_unavailable", degradedReasons)

    return {
      snapshot: {
        capturedAt: this.nowIso(),
        repository: "available",
        ...(branch && branch !== "HEAD" ? { branch } : {}),
        ...(head ? { head } : {}),
        dirty: statusByPath.size > 0,
        fileCount: statusByPath.size,
      },
      statusByPath,
      fingerprintByPath,
      degradedReasons,
    }
  }

  private async readStatusFingerprints(
    workspaceRoot: string,
    statusEntries: GitStatusEntry[],
    degradedReasons: string[]
  ): Promise<Map<string, string>> {
    const fingerprints = new Map<string, string>()
    for (const entry of statusEntries) {
      const fingerprint = await this.readStatusFingerprint(workspaceRoot, entry, degradedReasons)
      if (fingerprint) {
        fingerprints.set(entry.path, fingerprint)
      }
    }
    return fingerprints
  }

  private async readStatusFingerprint(
    workspaceRoot: string,
    entry: GitStatusEntry,
    degradedReasons: string[]
  ): Promise<string | undefined> {
    if (entry.status === "??") {
      try {
        const fullPath = join(workspaceRoot, entry.path)
        const fileStat = await stat(fullPath)
        if (!fileStat.isFile()) {
          return hashText(`untracked:${entry.path}:${entry.status}`)
        }
        const content = await readFile(fullPath)
        return hashBuffer(Buffer.concat([
          Buffer.from(`untracked:${entry.path}:${entry.status}\0`, "utf8"),
          content,
        ]))
      } catch {
        degradedReasons.push("fingerprint_unavailable")
        return undefined
      }
    }

    const result = await this.runGit(workspaceRoot, [
      "diff",
      "HEAD",
      "--patch",
      "--",
      entry.path,
    ], { allowFailure: true })
    if (result.exitCode !== 0) {
      degradedReasons.push("fingerprint_unavailable")
      return undefined
    }
    return hashText(`${entry.status}\0${result.stdout}`)
  }

  private async readOptionalGitValue(
    workspaceRoot: string,
    args: string[],
    degradedReason: string,
    degradedReasons: string[]
  ): Promise<string | undefined> {
    const result = await this.runGit(workspaceRoot, args, { allowFailure: true })
    if (result.exitCode !== 0) {
      degradedReasons.push(degradedReason)
      return undefined
    }
    const value = result.stdout.trim()
    return value || undefined
  }

  private async readNumstat(
    workspaceRoot: string,
    limitations: string[]
  ): Promise<Map<string, GitNumstatEntry>> {
    const result = await this.runGit(workspaceRoot, [
      "diff",
      "HEAD",
      "--numstat",
      "-z",
      "--",
      ".",
    ], { allowFailure: true })
    if (result.exitCode !== 0) {
      limitations.push("numstat_unavailable")
      return new Map()
    }
    return new Map(parseGitNumstatZ(result.stdout).map((entry) => [entry.path, entry]))
  }

  private async readPatch(
    workspaceRoot: string,
    limitations: string[]
  ): Promise<WorkspaceDiffPatch | undefined> {
    const result = await this.runGit(workspaceRoot, [
      "diff",
      "HEAD",
      "--patch",
      "--",
      ".",
    ], {
      allowFailure: true,
      maxBufferBytes: GIT_MAX_BUFFER_BYTES,
    })
    if (result.exitCode !== 0) {
      limitations.push("patch_unavailable")
      return undefined
    }

    const bytes = Buffer.byteLength(result.stdout, "utf8")
    if (bytes <= PATCH_MAX_BYTES) {
      return {
        text: result.stdout,
        bytes,
        maxBytes: PATCH_MAX_BYTES,
        truncated: false,
      }
    }

    limitations.push("patch_truncated")
    return {
      text: truncateUtf8(result.stdout, PATCH_MAX_BYTES),
      bytes,
      maxBytes: PATCH_MAX_BYTES,
      truncated: true,
      omittedReason: "patch_exceeded_budget",
    }
  }

  private async runGit(
    workspaceRoot: string,
    args: string[],
    options: GitCommandOptions = {}
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const runner = this.dependencies.runGit ?? runGitCommand
    return runner(workspaceRoot, args, options)
  }

  private createUnavailableSnapshot(reason: string): WorkspaceDiffSnapshot {
    return {
      capturedAt: this.nowIso(),
      repository: reason === "not_repository" ? "not_repository" : "unknown",
      dirty: false,
      fileCount: 0,
      unavailableReason: reason,
    }
  }

  private createUnavailableSummary(
    workspace: RunWorkspaceSummary | undefined,
    baseline: WorkspaceDiffSnapshot,
    final: WorkspaceDiffSnapshot,
    code: string,
    message: string
  ): WorkspaceDiffSummary {
    return {
      version: 1,
      status: "unavailable",
      source: "git",
      ...(workspace ? { workspace } : {}),
      baseline,
      final,
      baselineDirty: baseline.dirty,
      runOnlyReliable: false,
      changedFiles: [],
      stats: createEmptyStats(),
      summary: message,
      limitations: [code],
      error: {
        code,
        message,
      },
    }
  }

  private nowIso(): string {
    return (this.dependencies.now?.() ?? new Date()).toISOString()
  }
}

async function runGitCommand(
  workspaceRoot: string,
  args: string[],
  options: GitCommandOptions = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync("git", ["-C", workspaceRoot, ...args], {
      timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
      maxBuffer: options.maxBufferBytes ?? GIT_MAX_BUFFER_BYTES,
      encoding: "utf8",
      windowsHide: true,
    })
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    }
  } catch (error) {
    const mapped = error as Record<string, unknown>
    if (options.allowFailure) {
      return {
        stdout: typeof mapped.stdout === "string" ? mapped.stdout : "",
        stderr: typeof mapped.stderr === "string" ? mapped.stderr : "",
        exitCode: typeof mapped.exitCode === "number" ? mapped.exitCode : 1,
      }
    }
    throw error
  }
}

function parseGitStatusPorcelainZ(stdout: string): GitStatusEntry[] {
  const tokens = stdout.split("\0").filter((token) => token.length > 0)
  const entries: GitStatusEntry[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.startsWith("## ")) continue
    if (token.length < 4) continue
    const status = token.slice(0, 2)
    const path = normalizeGitPath(token.slice(3))
    if (!path) continue
    entries.push({ path, status })
    if (status[0] === "R" || status[0] === "C") {
      index += 1
    }
  }
  return entries
}

function parseGitNumstatZ(stdout: string): GitNumstatEntry[] {
  const tokens = stdout.split("\0").filter((token) => token.length > 0)
  const entries: GitNumstatEntry[] = []
  for (const token of tokens) {
    const [additionsRaw, deletionsRaw, pathRaw] = token.split("\t")
    if (!pathRaw) continue
    const binary = additionsRaw === "-" || deletionsRaw === "-"
    entries.push({
      path: normalizeGitPath(pathRaw),
      ...(binary ? { binary: true } : {
        additions: Number.parseInt(additionsRaw ?? "0", 10) || 0,
        deletions: Number.parseInt(deletionsRaw ?? "0", 10) || 0,
      }),
    })
  }
  return entries
}

function buildChangedFiles(
  before: Map<string, string>,
  after: Map<string, string>,
  beforeFingerprints: Map<string, string>,
  afterFingerprints: Map<string, string>,
  baselineDirty: boolean
): WorkspaceDiffFile[] {
  const paths = new Set([...before.keys(), ...after.keys()])
  return [...paths].sort((left, right) => left.localeCompare(right)).map((path) => {
    const statusBefore = before.get(path)
    const statusAfter = after.get(path)
    if (
      baselineDirty &&
      statusBefore &&
      statusAfter &&
      statusBefore === statusAfter &&
      beforeFingerprints.has(path) &&
      beforeFingerprints.get(path) === afterFingerprints.get(path)
    ) {
      return null
    }
    return {
      path,
      ...(statusBefore ? { statusBefore } : {}),
      ...(statusAfter ? { statusAfter } : {}),
      origin: resolveFileOrigin(statusBefore, statusAfter, baselineDirty),
    }
  }).filter((file): file is WorkspaceDiffFile => Boolean(file))
}

function resolveFileOrigin(
  statusBefore: string | undefined,
  statusAfter: string | undefined,
  baselineDirty: boolean
): WorkspaceDiffFileOrigin {
  if (!statusBefore && statusAfter) return "new-since-baseline"
  if (statusBefore && !statusAfter) return "removed-since-baseline"
  if (statusBefore && statusAfter && statusBefore !== statusAfter) return "status-changed"
  if (statusBefore && statusAfter && baselineDirty) return "unknown-dirty-baseline"
  return "unchanged-baseline"
}

function applyNumstat(
  changedFiles: WorkspaceDiffFile[],
  numstat: Map<string, GitNumstatEntry>
): void {
  for (const file of changedFiles) {
    const entry = numstat.get(file.path)
    if (!entry) continue
    file.additions = entry.additions
    file.deletions = entry.deletions
    file.binary = entry.binary
  }
}

async function applyMissingLineStats(
  workspaceRoot: string,
  changedFiles: WorkspaceDiffFile[],
  limitations: string[]
): Promise<void> {
  for (const file of changedFiles) {
    if (file.additions !== undefined || file.deletions !== undefined || file.binary === true) {
      continue
    }
    if (file.statusAfter !== "??") {
      continue
    }

    try {
      const fullPath = join(workspaceRoot, file.path)
      const fileStat = await stat(fullPath)
      if (!fileStat.isFile()) {
        continue
      }
      const content = await readFile(fullPath)
      if (content.includes(0)) {
        file.binary = true
        continue
      }
      file.additions = countTextLines(content)
      file.deletions = 0
    } catch {
      limitations.push("untracked_numstat_unavailable")
    }
  }
}

function countTextLines(content: Buffer): number {
  if (content.length === 0) return 0
  let lines = 0
  for (const byte of content) {
    if (byte === 10) lines += 1
  }
  return content[content.length - 1] === 10 ? lines : lines + 1
}

function buildStats(files: WorkspaceDiffFile[]): WorkspaceDiffStats {
  const stats = createEmptyStats()
  stats.filesChanged = files.length
  for (const file of files) {
    stats.additions += file.additions ?? 0
    stats.deletions += file.deletions ?? 0
    const status = file.statusAfter ?? file.statusBefore ?? ""
    if (status === "??") {
      stats.untracked += 1
      continue
    }
    if (isConflictedStatus(status)) {
      stats.conflicted += 1
      continue
    }
    if (status.includes("M") || status.includes("T")) stats.modified += 1
    if (status.includes("A")) stats.added += 1
    if (status.includes("D")) stats.deleted += 1
    if (status.includes("R") || status.includes("C")) stats.renamed += 1
  }
  return stats
}

function createEmptyStats(): WorkspaceDiffStats {
  return {
    filesChanged: 0,
    additions: 0,
    deletions: 0,
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    untracked: 0,
    conflicted: 0,
  }
}

function formatWorkspaceDiffSummary(
  files: WorkspaceDiffFile[],
  stats: WorkspaceDiffStats,
  options: {
    baselineDirty: boolean
    status: WorkspaceDiffSummary["status"]
    unavailableReason?: string
  }
): string {
  if (options.status === "unavailable") {
    return `Workspace diff unavailable${options.unavailableReason ? `: ${options.unavailableReason}` : ""}`
  }
  if (files.length === 0) {
    return options.baselineDirty
      ? "No additional workspace changes detected; run started from a dirty baseline"
      : "No workspace changes detected"
  }
  const lineStats = stats.additions > 0 || stats.deletions > 0
    ? ` (+${stats.additions}/-${stats.deletions})`
    : ""
  if (options.baselineDirty) {
    return `${files.length} workspace file${files.length === 1 ? "" : "s"} changed since baseline${lineStats}; baseline was dirty`
  }
  return `${files.length} workspace file${files.length === 1 ? "" : "s"} changed${lineStats}`
}

function isConflictedStatus(status: string): boolean {
  return ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(status)
}

function normalizeGitPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "")
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8")
  if (bytes.length <= maxBytes) return text
  return bytes.subarray(0, maxBytes).toString("utf8")
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex")
}

function mapGitError(error: unknown): { code: string; message: string } {
  const record = typeof error === "object" && error ? error as Record<string, unknown> : {}
  const code = record.code
  const signal = record.signal
  const stderr = typeof record.stderr === "string" ? record.stderr : ""
  if (code === "ENOENT") {
    return { code: "git_not_found", message: "Git executable was not found" }
  }
  if (signal === "SIGTERM" || record.killed === true) {
    return { code: "git_timeout", message: "Git command timed out while computing workspace diff" }
  }
  if (stderr.includes("not a git repository") || stderr.includes("not a git repo")) {
    return { code: "not_repository", message: "Workspace is not a git repository" }
  }
  return { code: "git_failed", message: "Git command failed while computing workspace diff" }
}
