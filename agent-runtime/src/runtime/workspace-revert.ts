import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { z } from "zod"
import { createChildLogger } from "../logger"
import { RunWorkspaceSnapshotSchema, WorkspaceDiffFileSchema, type RunWorkspaceSnapshot } from "./types"

const execFileAsync = promisify(execFile)
const log = createChildLogger("workspace-revert")

const GIT_TIMEOUT_MS = 3_000
const GIT_MAX_BUFFER_BYTES = 1024 * 1024

export const WorkspaceRevertSourceSchema = z.object({
  artifactId: z.string().min(1),
  changeSetId: z.string().min(1).optional(),
  runId: z.string().min(1),
  patchText: z.string(),
  patchTruncated: z.boolean(),
  baselineDirty: z.boolean(),
  runOnlyReliable: z.boolean(),
  changedFiles: z.array(WorkspaceDiffFileSchema.extend({
    oldPath: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    truncated: z.boolean().optional(),
  }).passthrough()),
}).strict()
export type WorkspaceRevertSource = z.infer<typeof WorkspaceRevertSourceSchema>

export const WorkspaceRevertRequestSchema = z.object({
  workspace: RunWorkspaceSnapshotSchema,
  source: WorkspaceRevertSourceSchema,
}).strict()
export type WorkspaceRevertRequest = z.infer<typeof WorkspaceRevertRequestSchema>

export type WorkspaceRevertFile = {
  path: string
  oldPath?: string
  status?: string
  additions?: number
  deletions?: number
  binary?: boolean
  action: "modify" | "delete-created" | "restore-deleted" | "revert-change"
}

export type WorkspaceRevertBlockedReason = {
  code:
    | "ARTIFACT_REVERT_UNSUPPORTED"
    | "ARTIFACT_REVERT_NOT_RELIABLE"
    | "ARTIFACT_REVERT_BLOCKED"
    | "WORKSPACE_REVERT_INVALID_INPUT"
    | "WORKSPACE_REVERT_APPLY_FAILED"
  message: string
}

export type WorkspaceRevertPreviewResponse = {
  status: "available" | "blocked"
  canApply: boolean
  files: WorkspaceRevertFile[]
  warnings: string[]
  blockedReason?: WorkspaceRevertBlockedReason
  source: {
    artifactId: string
    changeSetId?: string
    runId: string
    patchDirection: "reverse-applied"
  }
}

export type WorkspaceRevertApplyResponse =
  | {
      status: "applied"
      operationId: string
      preview: WorkspaceRevertPreviewResponse
      workspace: {
        workspaceId: string
        backendType: "local"
      }
      appliedAt: string
    }
  | {
      status: "blocked"
      preview: WorkspaceRevertPreviewResponse
      blockedReason: WorkspaceRevertBlockedReason
    }
  | {
      status: "failed"
      preview: WorkspaceRevertPreviewResponse
      error: WorkspaceRevertBlockedReason
    }

export class WorkspaceRevertService {
  async preview(request: WorkspaceRevertRequest): Promise<WorkspaceRevertPreviewResponse> {
    const validationBlock = this.validateRequest(request)
    if (validationBlock) {
      return this.blockedPreview(request.source, validationBlock)
    }

    const repoBlock = await this.ensureGitRepository(request.workspace)
    if (repoBlock) {
      return this.blockedPreview(request.source, repoBlock)
    }

    const check = await this.runGitApply(request.workspace.rootPath, request.source.patchText, true)
    if (check.exitCode !== 0) {
      return this.blockedPreview(request.source, {
        code: "ARTIFACT_REVERT_BLOCKED",
        message: "The current workspace state cannot safely reverse-apply this patch.",
      })
    }

    return {
      status: "available",
      canApply: true,
      files: request.source.changedFiles.map(toRevertFile),
      warnings: [],
      source: toPreviewSource(request.source),
    }
  }

  async apply(request: WorkspaceRevertRequest): Promise<WorkspaceRevertApplyResponse> {
    const preview = await this.preview(request)
    if (!preview.canApply) {
      return {
        status: "blocked",
        preview,
        blockedReason: preview.blockedReason ?? {
          code: "ARTIFACT_REVERT_BLOCKED",
          message: "The patch cannot be reverse-applied.",
        },
      }
    }

    const result = await this.runGitApply(request.workspace.rootPath, request.source.patchText, false)
    if (result.exitCode !== 0) {
      const error: WorkspaceRevertBlockedReason = {
        code: "WORKSPACE_REVERT_APPLY_FAILED",
        message: "The patch check passed but applying the reverse patch failed.",
      }
      log.warn({
        workspaceId: request.workspace.workspaceId,
        artifactId: request.source.artifactId,
        stderrLength: result.stderr.length,
      }, "Workspace revert apply failed")
      return { status: "failed", preview, error }
    }

    await this.refreshChangedFileIndex(request.workspace.rootPath, request.source.changedFiles)

    return {
      status: "applied",
      operationId: `revert_${crypto.randomUUID()}`,
      preview,
      workspace: {
        workspaceId: request.workspace.workspaceId,
        backendType: request.workspace.backendType,
      },
      appliedAt: new Date().toISOString(),
    }
  }

  private validateRequest(request: WorkspaceRevertRequest): WorkspaceRevertBlockedReason | null {
    const source = request.source
    if (request.workspace.backendType !== "local" || !request.workspace.rootPath) {
      return {
        code: "WORKSPACE_REVERT_INVALID_INPUT",
        message: "A local workspace root is required to revert workspace changes.",
      }
    }
    if (!source.patchText.trim() || source.changedFiles.length === 0) {
      return {
        code: "ARTIFACT_REVERT_UNSUPPORTED",
        message: "This diff artifact does not contain a complete patch to reverse.",
      }
    }
    if (source.patchTruncated || source.changedFiles.some((file) => file.truncated === true)) {
      return {
        code: "ARTIFACT_REVERT_UNSUPPORTED",
        message: "Truncated patches cannot be safely reverted.",
      }
    }
    if (source.changedFiles.some((file) => file.binary === true)) {
      return {
        code: "ARTIFACT_REVERT_UNSUPPORTED",
        message: "Binary file patches cannot be reverted in V0.",
      }
    }
    if (source.baselineDirty || !source.runOnlyReliable) {
      return {
        code: "ARTIFACT_REVERT_NOT_RELIABLE",
        message: "Only clean-baseline reliable run diffs can be reverted.",
      }
    }
    return null
  }

  private async ensureGitRepository(
    workspace: RunWorkspaceSnapshot,
  ): Promise<WorkspaceRevertBlockedReason | null> {
    const result = await runGit(workspace.rootPath, ["rev-parse", "--is-inside-work-tree"], {
      allowFailure: true,
    })
    if (result.exitCode !== 0 || result.stdout.trim() !== "true") {
      return {
        code: "ARTIFACT_REVERT_BLOCKED",
        message: "Workspace revert requires an available git repository.",
      }
    }
    return null
  }

  private async runGitApply(
    workspaceRoot: string,
    patchText: string,
    checkOnly: boolean,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const patchDir = await mkdtemp(join(tmpdir(), "agenthub-revert-patch-"))
    const patchPath = join(patchDir, "source.patch")
    try {
      await writeFile(patchPath, patchText, "utf8")
      return await runGit(workspaceRoot, [
        "apply",
        "--reverse",
        ...(checkOnly ? ["--check"] : []),
        "--whitespace=nowarn",
        patchPath,
      ], { allowFailure: true })
    } finally {
      await rm(patchDir, { recursive: true, force: true })
    }
  }

  private async refreshChangedFileIndex(
    workspaceRoot: string,
    changedFiles: WorkspaceRevertSource["changedFiles"],
  ): Promise<void> {
    const paths = [
      ...new Set(changedFiles
        .flatMap((file) => [file.path, file.oldPath])
        .filter((path): path is string => Boolean(path))),
    ]
    if (paths.length === 0) return

    const result = await runGit(workspaceRoot, [
      "update-index",
      "--refresh",
      "--",
      ...paths,
    ], { allowFailure: true })
    if (result.exitCode !== 0) {
      log.debug({
        pathCount: paths.length,
        stderrLength: result.stderr.length,
      }, "Workspace revert index refresh did not fully complete")
    }
  }

  private blockedPreview(
    source: WorkspaceRevertSource,
    blockedReason: WorkspaceRevertBlockedReason,
  ): WorkspaceRevertPreviewResponse {
    return {
      status: "blocked",
      canApply: false,
      files: source.changedFiles.map(toRevertFile),
      warnings: [],
      blockedReason,
      source: toPreviewSource(source),
    }
  }
}

async function runGit(
  workspaceRoot: string,
  args: string[],
  options: { allowFailure?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync("git", ["-C", workspaceRoot, ...args], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER_BYTES,
      encoding: "utf8",
      windowsHide: true,
    })
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
  } catch (error) {
    if (!options.allowFailure) throw error
    const mapped = error as Record<string, unknown>
    return {
      stdout: typeof mapped.stdout === "string" ? mapped.stdout : "",
      stderr: typeof mapped.stderr === "string" ? mapped.stderr : "",
      exitCode: typeof mapped.exitCode === "number" ? mapped.exitCode : 1,
    }
  }
}

function toPreviewSource(source: WorkspaceRevertSource): WorkspaceRevertPreviewResponse["source"] {
  return {
    artifactId: source.artifactId,
    ...(source.changeSetId ? { changeSetId: source.changeSetId } : {}),
    runId: source.runId,
    patchDirection: "reverse-applied",
  }
}

function toRevertFile(file: WorkspaceRevertSource["changedFiles"][number]): WorkspaceRevertFile {
  const status = file.status ?? file.statusAfter ?? file.statusBefore
  return {
    path: file.path,
    ...(file.oldPath ? { oldPath: file.oldPath } : {}),
    ...(status ? { status } : {}),
    ...(file.additions !== undefined ? { additions: file.additions } : {}),
    ...(file.deletions !== undefined ? { deletions: file.deletions } : {}),
    ...(file.binary !== undefined ? { binary: file.binary } : {}),
    action: resolveRevertAction(file),
  }
}

function resolveRevertAction(file: WorkspaceRevertSource["changedFiles"][number]): WorkspaceRevertFile["action"] {
  if (file.statusAfter === "??" || file.origin === "new-since-baseline") {
    return "delete-created"
  }
  if (file.statusAfter?.includes("D") || file.origin === "removed-since-baseline") {
    return "restore-deleted"
  }
  if (file.statusAfter?.includes("M") || file.statusBefore?.includes("M")) {
    return "modify"
  }
  return "revert-change"
}
