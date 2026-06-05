import { describe, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import {
  WorkspaceDiffService,
  WorkspaceRevertService,
  type WorkspaceRevertSource,
} from "../src/runtime"

const execFileAsync = promisify(execFile)

async function runGit(root: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
  })
  return result.stdout
}

async function createGitWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-runtime-workspace-revert-"))
  await mkdir(join(root, "src"), { recursive: true })
  await writeFile(join(root, "src", "note.txt"), "initial\n", "utf8")
  await runGit(root, ["init"])
  await runGit(root, ["config", "user.email", "agenthub@example.local"])
  await runGit(root, ["config", "user.name", "AgentHub Test"])
  await runGit(root, ["add", "."])
  await runGit(root, ["commit", "-m", "initial"])
  return root
}

async function buildSourceFromCurrentDiff(
  root: string,
  baseline: Awaited<ReturnType<WorkspaceDiffService["captureBaseline"]>>,
  overrides: Partial<WorkspaceRevertSource> = {},
): Promise<WorkspaceRevertSource> {
  const diffService = new WorkspaceDiffService()
  const workspaceService = {
    getHandle: () => ({
      workspaceId: "workspace_revert_test",
      backendType: "local",
      rootLabel: "workspace",
      rootPath: root,
    }),
  }
  const summary = await diffService.summarize(workspaceService as never, baseline)

  return {
    artifactId: "art_source",
    changeSetId: "wcs_source",
    runId: "run_source",
    patchText: summary.patch?.text ?? "",
    patchTruncated: summary.patch?.truncated ?? false,
    baselineDirty: false,
    runOnlyReliable: true,
    changedFiles: summary.changedFiles,
    ...overrides,
  }
}

function createService() {
  return new WorkspaceRevertService()
}

async function captureCleanBaseline(root: string) {
  const diffService = new WorkspaceDiffService()
  const workspaceService = {
    getHandle: () => ({
      workspaceId: "workspace_revert_test",
      backendType: "local",
      rootLabel: "workspace",
      rootPath: root,
    }),
  }
  return diffService.captureBaseline(workspaceService as never)
}

describe("WorkspaceRevertService", () => {
  test("previews and applies a tracked file revert", async () => {
    const root = await createGitWorkspace()
    const baseline = await captureCleanBaseline(root)
    await writeFile(join(root, "src", "note.txt"), "changed\n", "utf8")
    const source = await buildSourceFromCurrentDiff(root, baseline)
    const service = createService()

    const preview = await service.preview({
      workspace: { workspaceId: "workspace_revert_test", backendType: "local", rootPath: root },
      source,
    })

    expect(preview.status).toBe("available")
    expect(preview.canApply).toBe(true)
    expect(preview.files).toHaveLength(1)
    expect(preview.files[0]?.path).toBe("src/note.txt")

    const applied = await service.apply({
      workspace: { workspaceId: "workspace_revert_test", backendType: "local", rootPath: root },
      source,
    })

    expect(applied.status).toBe("applied")
    if (applied.status !== "applied") {
      throw new Error(`Expected revert apply to succeed, got ${applied.status}`)
    }
    expect(applied.preview.canApply).toBe(true)
    expect(applied.operationId).toMatch(/^revert_/)
    const note = await readFile(join(root, "src", "note.txt"), "utf8")
    expect(note.replaceAll("\r\n", "\n")).toBe("initial\n")
    expect((await runGit(root, ["status", "--porcelain"])).trim()).toBe("")
  })

  test("reverse-applies an added untracked text file by removing it", async () => {
    const root = await createGitWorkspace()
    const baseline = await captureCleanBaseline(root)
    await writeFile(join(root, "src", "new.txt"), "new\nfile\n", "utf8")
    const source = await buildSourceFromCurrentDiff(root, baseline)
    const service = createService()

    const applied = await service.apply({
      workspace: { workspaceId: "workspace_revert_test", backendType: "local", rootPath: root },
      source,
    })

    expect(applied.status).toBe("applied")
    await expect(stat(join(root, "src", "new.txt"))).rejects.toThrow()
  })

  test("blocks unreliable or incomplete source patches", async () => {
    const root = await createGitWorkspace()
    const baseline = await captureCleanBaseline(root)
    await writeFile(join(root, "src", "note.txt"), "changed\n", "utf8")
    const source = await buildSourceFromCurrentDiff(root, baseline)
    const service = createService()

    const dirty = await service.preview({
      workspace: { workspaceId: "workspace_revert_test", backendType: "local", rootPath: root },
      source: { ...source, baselineDirty: true },
    })
    expect(dirty.status).toBe("blocked")
    expect(dirty.blockedReason?.code).toBe("ARTIFACT_REVERT_NOT_RELIABLE")

    const truncated = await service.preview({
      workspace: { workspaceId: "workspace_revert_test", backendType: "local", rootPath: root },
      source: { ...source, patchTruncated: true },
    })
    expect(truncated.status).toBe("blocked")
    expect(truncated.blockedReason?.code).toBe("ARTIFACT_REVERT_UNSUPPORTED")
  })

  test("blocks conflicts without mutating files", async () => {
    const root = await createGitWorkspace()
    const baseline = await captureCleanBaseline(root)
    await writeFile(join(root, "src", "note.txt"), "changed\n", "utf8")
    const source = await buildSourceFromCurrentDiff(root, baseline)
    await writeFile(join(root, "src", "note.txt"), "conflicting\n", "utf8")
    const service = createService()

    const applied = await service.apply({
      workspace: { workspaceId: "workspace_revert_test", backendType: "local", rootPath: root },
      source,
    })

    expect(applied.status).toBe("blocked")
    if (applied.status !== "blocked") {
      throw new Error(`Expected revert apply to be blocked, got ${applied.status}`)
    }
    expect(applied.blockedReason?.code).toBe("ARTIFACT_REVERT_BLOCKED")
    expect(await readFile(join(root, "src", "note.txt"), "utf8")).toBe("conflicting\n")
  })
})
