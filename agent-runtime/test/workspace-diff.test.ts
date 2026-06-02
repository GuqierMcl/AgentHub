import { describe, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import {
  WorkspaceDiffService,
  WorkspaceService,
  type GitCommandRunner,
} from "../src/runtime"

const execFileAsync = promisify(execFile)

async function runGit(root: string, args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
  })
}

async function createGitWorkspace(): Promise<{
  root: string
  workspaceService: WorkspaceService
}> {
  const root = await mkdtemp(join(tmpdir(), "agent-runtime-workspace-diff-"))
  await mkdir(join(root, "src"), { recursive: true })
  await writeFile(join(root, "src", "note.txt"), "initial\n", "utf8")
  await writeFile(join(root, "src", "remove.txt"), "remove me\n", "utf8")
  await runGit(root, ["init"])
  await runGit(root, ["config", "user.email", "agenthub@example.local"])
  await runGit(root, ["config", "user.name", "AgentHub Test"])
  await runGit(root, ["add", "."])
  await runGit(root, ["commit", "-m", "initial"])
  return {
    root,
    workspaceService: new WorkspaceService({
      workdir: root,
      workspaceId: "workspace_diff_test",
      runId: "run_workspace_diff_test",
    }),
  }
}

describe("WorkspaceDiffService", () => {
  test("returns an available no-change summary for a clean git workspace", async () => {
    const { workspaceService } = await createGitWorkspace()
    const service = new WorkspaceDiffService()

    const baseline = await service.captureBaseline(workspaceService)
    const summary = await service.summarize(workspaceService, baseline)

    expect(summary.status).toBe("available")
    expect(summary.source).toBe("git")
    expect(summary.baselineDirty).toBe(false)
    expect(summary.runOnlyReliable).toBe(true)
    expect(summary.changedFiles).toHaveLength(0)
    expect(summary.stats.filesChanged).toBe(0)
    expect(summary.summary).toContain("No workspace changes")
  })

  test("summarizes tracked and untracked file changes", async () => {
    const { root, workspaceService } = await createGitWorkspace()
    const service = new WorkspaceDiffService()
    const baseline = await service.captureBaseline(workspaceService)

    await writeFile(join(root, "src", "note.txt"), "changed\n", "utf8")
    await writeFile(join(root, "src", "new.txt"), "new\n", "utf8")

    const summary = await service.summarize(workspaceService, baseline)
    const byPath = new Map(summary.changedFiles.map((file) => [file.path, file]))

    expect(summary.status).toBe("available")
    expect(summary.baselineDirty).toBe(false)
    expect(summary.runOnlyReliable).toBe(true)
    expect(summary.stats.filesChanged).toBe(2)
    expect(summary.stats.additions).toBe(2)
    expect(summary.stats.deletions).toBe(1)
    expect(summary.stats.modified).toBe(1)
    expect(summary.stats.untracked).toBe(1)
    expect(byPath.get("src/note.txt")?.origin).toBe("new-since-baseline")
    expect(byPath.get("src/note.txt")?.additions).toBe(1)
    expect(byPath.get("src/note.txt")?.deletions).toBe(1)
    expect(byPath.get("src/note.txt")?.statusAfter).toContain("M")
    expect(byPath.get("src/new.txt")?.statusAfter).toBe("??")
    expect(byPath.get("src/new.txt")?.additions).toBe(1)
    expect(byPath.get("src/new.txt")?.deletions).toBe(0)
    expect(summary.patch?.text).toContain("changed")
  })

  test("builds a fallback patch for untracked files when the git repository has no HEAD", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-workspace-diff-unborn-"))
    await runGit(root, ["init"])
    const workspaceService = new WorkspaceService({
      workdir: root,
      workspaceId: "workspace_diff_unborn",
      runId: "run_workspace_diff_unborn",
    })
    const service = new WorkspaceDiffService()
    const baseline = await service.captureBaseline(workspaceService)

    await writeFile(join(root, "hello.txt"), "hello\nworld\n", "utf8")
    const summary = await service.summarize(workspaceService, baseline)

    expect(summary.status).toBe("degraded")
    expect(summary.baselineDirty).toBe(false)
    expect(summary.runOnlyReliable).toBe(true)
    expect(summary.limitations).toContain("head_unavailable")
    expect(summary.limitations).not.toContain("branch_unavailable")
    expect(summary.limitations).not.toContain("numstat_unavailable")
    expect(summary.limitations).not.toContain("patch_unavailable")
    expect(summary.changedFiles[0]?.path).toBe("hello.txt")
    expect(summary.changedFiles[0]?.additions).toBe(2)
    expect(summary.patch?.text).toContain("--- /dev/null")
    expect(summary.patch?.text).toContain("+++ b/hello.txt")
    expect(summary.patch?.text).toContain("+hello")
  })

  test("summarizes deleted and renamed tracked files", async () => {
    const { root, workspaceService } = await createGitWorkspace()
    const service = new WorkspaceDiffService()
    const baseline = await service.captureBaseline(workspaceService)

    await runGit(root, ["mv", "src/note.txt", "src/renamed.txt"])
    await unlink(join(root, "src", "remove.txt"))

    const summary = await service.summarize(workspaceService, baseline)
    const byPath = new Map(summary.changedFiles.map((file) => [file.path, file]))

    expect(summary.status).toBe("available")
    expect(summary.stats.filesChanged).toBe(2)
    expect(summary.stats.renamed).toBe(1)
    expect(summary.stats.deleted).toBe(1)
    expect(byPath.get("src/renamed.txt")?.statusAfter).toContain("R")
    expect(byPath.get("src/remove.txt")?.statusAfter).toContain("D")
  })

  test("marks dirty baseline summaries as not reliably run-only", async () => {
    const { root, workspaceService } = await createGitWorkspace()
    const service = new WorkspaceDiffService()

    await writeFile(join(root, "src", "note.txt"), "dirty before run\n", "utf8")
    const baseline = await service.captureBaseline(workspaceService)
    const summary = await service.summarize(workspaceService, baseline)

    expect(summary.status).toBe("degraded")
    expect(summary.baselineDirty).toBe(true)
    expect(summary.runOnlyReliable).toBe(false)
    expect(summary.limitations).toContain("baseline_dirty_final_diff_is_not_precise_run_only")
    expect(summary.changedFiles).toHaveLength(0)
    expect(summary.stats.filesChanged).toBe(0)
    expect(summary.summary).toContain("No additional workspace changes")
  })

  test("keeps dirty baseline files when their content changes during the run", async () => {
    const { root, workspaceService } = await createGitWorkspace()
    const service = new WorkspaceDiffService()

    await writeFile(join(root, "src", "note.txt"), "dirty before run\n", "utf8")
    const baseline = await service.captureBaseline(workspaceService)
    await writeFile(join(root, "src", "note.txt"), "dirty changed during run\n", "utf8")
    const summary = await service.summarize(workspaceService, baseline)

    expect(summary.status).toBe("degraded")
    expect(summary.baselineDirty).toBe(true)
    expect(summary.runOnlyReliable).toBe(false)
    expect(summary.changedFiles).toHaveLength(1)
    expect(summary.changedFiles[0]?.origin).toBe("unknown-dirty-baseline")
    expect(summary.changedFiles[0]?.path).toBe("src/note.txt")
    expect(summary.summary).toContain("changed since baseline")
  })

  test("returns unavailable summaries for missing or non-git workspaces", async () => {
    const service = new WorkspaceDiffService()
    const unbound = await service.summarize()
    expect(unbound.status).toBe("unavailable")
    expect(unbound.error?.code).toBe("workspace_not_bound")

    const nonGitRoot = await mkdtemp(join(tmpdir(), "agent-runtime-workspace-diff-nongit-"))
    const workspaceService = new WorkspaceService({
      workdir: nonGitRoot,
      workspaceId: "workspace_diff_nongit",
      runId: "run_workspace_diff_nongit",
    })
    const nonGit = await service.summarize(workspaceService)
    expect(nonGit.status).toBe("unavailable")
    expect(nonGit.error?.code).toBe("not_repository")
    expect(nonGit.final.repository).toBe("not_repository")
  })

  test("handles git command failures and patch truncation without failing the run", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-runtime-workspace-diff-mock-"))
    const workspaceService = new WorkspaceService({
      workdir: root,
      workspaceId: "workspace_diff_mock",
      runId: "run_workspace_diff_mock",
    })
    const gitNotFound = new WorkspaceDiffService({
      runGit: async () => {
        const error = new Error("missing git") as Error & { code: string }
        error.code = "ENOENT"
        throw error
      },
    })
    const unavailable = await gitNotFound.summarize(workspaceService)
    expect(unavailable.status).toBe("unavailable")
    expect(unavailable.error?.code).toBe("git_not_found")

    let statusCalls = 0
    const largePatch = `diff --git a/src/note.txt b/src/note.txt\n${"x".repeat(220_000)}`
    const mockGit: GitCommandRunner = async (_workspaceRoot, args) => {
      const command = args.join(" ")
      if (command.startsWith("status ")) {
        statusCalls += 1
        return {
          stdout: statusCalls === 1
            ? "## main\0"
            : "## main\0 M src/note.txt\0",
          stderr: "",
          exitCode: 0,
        }
      }
      if (command.includes("rev-parse --verify HEAD")) {
        return { stdout: "abc123\n", stderr: "", exitCode: 0 }
      }
      if (command.includes("rev-parse --abbrev-ref HEAD")) {
        return { stdout: "main\n", stderr: "", exitCode: 0 }
      }
      if (command.includes("diff HEAD --numstat")) {
        return { stdout: "1\t0\tsrc/note.txt\0", stderr: "", exitCode: 0 }
      }
      if (command.includes("diff HEAD --patch")) {
        return { stdout: largePatch, stderr: "", exitCode: 0 }
      }
      return { stdout: "", stderr: "", exitCode: 0 }
    }

    const truncating = new WorkspaceDiffService({ runGit: mockGit })
    const baseline = await truncating.captureBaseline(workspaceService)
    const truncated = await truncating.summarize(workspaceService, baseline)

    expect(truncated.status).toBe("degraded")
    expect(truncated.patch?.truncated).toBe(true)
    expect(truncated.patch?.text.length).toBeLessThan(largePatch.length)
    expect(truncated.limitations).toContain("patch_truncated")
  })
})
