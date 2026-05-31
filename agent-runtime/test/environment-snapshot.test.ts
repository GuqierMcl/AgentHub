import { describe, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { promisify } from "node:util"
import { AgentRegistry } from "../src/agents"
import {
  buildRuntimeEnvironmentSnapshot,
  createDefaultRuntimeToolRegistry,
  createRunEvent,
  formatRuntimeEnvironmentSnapshotForPrompt,
  inspectGitStatus,
  parseGitStatus,
  RunManager,
  WorkspaceService,
  type AgentExecutionContext,
  type RunEvent,
} from "../src/runtime"
import { buildSystemPrompt } from "../src/runtime/ai-sdk-executor"
import { OrchestratorExecutor } from "../src/runtime/orchestrator-executor"
import type { ProviderService } from "../src/provider"

const execFileAsync = promisify(execFile)

async function createWorkspace(runId = "run_environment"): Promise<{ root: string; workspaceService: WorkspaceService }> {
  const root = await mkdtemp(join(tmpdir(), "agent-runtime-environment-"))
  await mkdir(root, { recursive: true })
  return {
    root,
    workspaceService: new WorkspaceService({
      workdir: root,
      workspaceId: "workspace_environment",
      runId,
    }),
  }
}

async function createInitializedRegistry(): Promise<AgentRegistry> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-environment-registry-"))
  const registry = new AgentRegistry(dataDir, createDefaultRuntimeToolRegistry())
  await registry.initialize()
  return registry
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForRunStatus(runManager: RunManager, runId: string, statuses: string[]): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = runManager.getRun(runId)
    if (run && statuses.includes(run.status)) {
      return
    }
    await sleep(10)
  }
  throw new Error(`Timed out waiting for run ${runId} to reach ${statuses.join(", ")}`)
}

async function gitAvailable(): Promise<boolean> {
  try {
    await execFileAsync("git", ["--version"], { timeout: 800, windowsHide: true })
    return true
  } catch {
    return false
  }
}

describe("Runtime environment snapshot", () => {
  test("includes time, OS, workspace, absolute path, shell, and prompt formatting", async () => {
    const { root, workspaceService } = await createWorkspace()
    const snapshot = await buildRuntimeEnvironmentSnapshot({
      workspaceService,
      now: new Date("2026-05-31T06:00:00.000Z"),
    })

    expect(snapshot.capturedAtIso).toBe("2026-05-31T06:00:00.000Z")
    expect(snapshot.timezone.length).toBeGreaterThan(0)
    expect(snapshot.os.platform).toBe(process.platform)
    expect(snapshot.workspace.bound).toBe(true)
    if (snapshot.workspace.bound) {
      expect(snapshot.workspace.cwd).toBe(".")
      expect(snapshot.workspace.absolutePath).toBe(root)
    }
    expect(snapshot.shell.toolName).toBe("bash")
    expect(snapshot.shell.displayName.length).toBeGreaterThan(0)

    const prompt = formatRuntimeEnvironmentSnapshotForPrompt(snapshot)
    expect(prompt).toContain("Runtime environment snapshot (captured at run start)")
    expect(prompt).toContain("Workspace cwd: .")
    expect(prompt).toContain(root)
    expect(prompt).toContain("Shell for bash tool")
  })

  test("works without a bound workspace", async () => {
    const snapshot = await buildRuntimeEnvironmentSnapshot({
      now: new Date("2026-05-31T06:00:00.000Z"),
    })

    expect(snapshot.workspace.bound).toBe(false)
    expect(snapshot.git.repository).toBe(false)
  })

  test("reports a non-git workspace without blocking snapshot creation", async () => {
    if (!await gitAvailable()) {
      expect(true).toBe(true)
      return
    }

    const { root, workspaceService } = await createWorkspace()
    const snapshot = await buildRuntimeEnvironmentSnapshot({ workspaceService })

    expect(snapshot.workspace.bound).toBe(true)
    if (snapshot.workspace.bound) {
      expect(snapshot.workspace.absolutePath).toBe(root)
    }
    expect(snapshot.git.repository).toBe(false)
    if (snapshot.git.repository === false) {
      expect(snapshot.git.unavailableReason).toBe("not_repository")
    }
  })

  test("git status command failures return an unavailable summary", async () => {
    const git = await inspectGitStatus(join(tmpdir(), "agent-runtime-missing-git-workspace"))

    expect(git.repository).not.toBe(true)
    if (git.repository !== true) {
      expect(git.unavailableReason?.length).toBeGreaterThan(0)
    }
  })

  test("parses git branch, dirty state, ahead/behind, and change counts without file names", () => {
    const git = parseGitStatus([
      "## main...origin/main [ahead 1, behind 2]",
      " M src/a.ts",
      "A  src/b.ts",
      "D  src/c.ts",
      "R  src/d.ts -> src/e.ts",
      "?? secret.env",
      "UU conflict.txt",
    ].join("\n"))

    expect(git.repository).toBe(true)
    if (git.repository === true) {
      expect(git.branch).toBe("main")
      expect(git.dirty).toBe(true)
      expect(git.ahead).toBe(1)
      expect(git.behind).toBe(2)
      expect(git.changes).toEqual({
        modified: 1,
        added: 1,
        deleted: 1,
        renamed: 1,
        untracked: 1,
        conflicted: 1,
      })
    }
  })

  test("summarizes a real git workspace when git is available", async () => {
    if (!await gitAvailable()) {
      expect(true).toBe(true)
      return
    }

    const { root } = await createWorkspace()
    await execFileAsync("git", ["init"], { cwd: root, timeout: 1_000, windowsHide: true })
    await writeFile(join(root, "notes.txt"), "hello")

    const git = await inspectGitStatus(root)
    expect(git.repository).toBe(true)
    if (git.repository === true) {
      expect(git.dirty).toBe(true)
      expect(git.changes.untracked).toBe(1)
    }
  })

  test("injects environment snapshot into AI SDK and Orchestrator prompts", async () => {
    const registry = await createInitializedRegistry()
    const coder = registry.getAgent("coder")!
    const orchestrator = registry.getAgent("orchestrator")!
    const { workspaceService } = await createWorkspace()
    const snapshot = await buildRuntimeEnvironmentSnapshot({ workspaceService })
    const input = {
      conversationId: "conv_environment_prompt",
      mode: "group" as const,
      participantAgentIds: ["orchestrator", "coder"],
      addressedAgentIds: [],
      userMessage: { role: "user" as const, content: "hello" },
      history: [],
    }
    const context = {
      runId: "run_environment_prompt",
      input,
      agent: coder,
      signal: new AbortController().signal,
      environmentSnapshot: snapshot,
    } satisfies AgentExecutionContext

    const aiPrompt = buildSystemPrompt(context)
    expect(aiPrompt).toContain("Runtime environment snapshot (captured at run start)")
    expect(aiPrompt).toContain("Workspace absolute path")

    const executor = new OrchestratorExecutor(
      registry,
      {} as ProviderService,
      createDefaultRuntimeToolRegistry()
    )
    const orchestratorPrompt = executor.buildSystemPrompt({
      ...context,
      agent: orchestrator,
    })
    expect(orchestratorPrompt).toContain("Runtime environment snapshot (captured at run start)")
    expect(orchestratorPrompt).toContain("Shell for bash tool")
  })

  test("shares one snapshot across delegated task and approval resume", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    const snapshots: unknown[] = []
    const { root } = await createWorkspace("placeholder")

    ;(runManager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        snapshots.push(context.environmentSnapshot)
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    ;(runManager as any).orchestratorExecutor = {
      executorType: "orchestrator",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        snapshots.push(context.environmentSnapshot)
        await context.runTask?.({
          taskId: "task_environment",
          targetAgentId: "coder",
          title: "Check environment",
          instruction: "Check environment snapshot.",
          expectedOutput: "A completed task",
          requiredCapabilities: [],
          riskLevel: "low",
          dependsOn: [],
        })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    const delegatedRun = runManager.createRun({
      conversationId: "conv_environment_delegated",
      mode: "group",
      participantAgentIds: ["orchestrator", "coder"],
      addressedAgentIds: [],
      userMessage: { role: "user", content: "delegate" },
      history: [],
      workspace: {
        workspaceId: "workspace_environment",
        backendType: "local",
        rootPath: root,
      },
    })
    await waitForRunStatus(runManager, delegatedRun.id, ["completed", "failed", "cancelled"])

    expect(snapshots.length).toBeGreaterThanOrEqual(2)
    expect(snapshots[0]).toBe(snapshots[1])

    snapshots.length = 0
    ;(runManager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        snapshots.push(context.environmentSnapshot)
        if (!context.resumeMessages) {
          const toolCallId = "tool_environment_approval"
          context.permissionService?.stageToolApproval({
            ...context,
            toolCallId,
            emitEvent: context.emitEvent ?? (() => {}),
          }, "bash", {
            reason: "Resume test",
            riskLevel: "low",
            data: {
              permissionType: "command_execute",
            },
          })
          context.permissionService?.bindAiSdkApproval(context.runId, toolCallId, "approval_environment")
          context.onApprovalPending?.([{ role: "user", content: "resume" }])
          return
        }
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    const approvalRun = runManager.createRun({
      conversationId: "conv_environment_approval",
      mode: "single",
      participantAgentIds: ["coder"],
      addressedAgentIds: ["coder"],
      userMessage: { role: "user", content: "approval" },
      history: [],
      workspace: {
        workspaceId: "workspace_environment",
        backendType: "local",
        rootPath: root,
      },
    })
    await waitForRunStatus(runManager, approvalRun.id, ["waiting_approval"])
    const request = runManager.listPermissions(approvalRun.id)[0]
    runManager.decidePermission(approvalRun.id, request.requestId, true)
    await waitForRunStatus(runManager, approvalRun.id, ["completed", "failed", "cancelled"])

    expect(snapshots.length).toBeGreaterThanOrEqual(2)
    expect(snapshots[0]).toBe(snapshots[1])
  })
})
