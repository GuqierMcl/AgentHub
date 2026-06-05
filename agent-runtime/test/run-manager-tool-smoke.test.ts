import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentRegistry } from "../src/agents"
import { RunManager, createDefaultRuntimeToolRegistry, createRunEvent, type OrchestratorTask, type RunEvent } from "../src/runtime"
import type { ProviderService } from "../src/provider"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createInitializedRegistry(): Promise<AgentRegistry> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-run-smoke-"))
  const registry = new AgentRegistry(dataDir, createDefaultRuntimeToolRegistry())
  await registry.initialize()
  return registry
}

async function waitForTerminalRun(runManager: RunManager, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = runManager.getRun(runId)
    if (run && (run.status === "completed" || run.status === "failed" || run.status === "cancelled")) {
      return
    }

    await sleep(10)
  }

  throw new Error(`Timed out waiting for run ${runId} to finish`)
}

describe("RunManager tool smoke", () => {
  test("orchestrator can delegate to a primary agent in the current group participants", async () => {
    const registry = await createInitializedRegistry()
    const providerService = {} as ProviderService
    const runManager = new RunManager(registry, providerService)

    ;(runManager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: {
        runId: string
        agent: { id: string }
      }): AsyncIterable<RunEvent> {
        yield createRunEvent(context.runId, "message.completed", context.agent.id, {
          content: `${context.agent.id} handled the delegated task.`,
        })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    ;(runManager as any).orchestratorExecutor = {
      executorType: "orchestrator",
      async *execute(context: {
        runId: string
        agent: { id: string }
        runTask?: (task: OrchestratorTask, options?: { groupId?: string; parentTaskId?: string }) => Promise<{
          status: "completed" | "failed" | "cancelled"
          summary: string
        }>
      }): AsyncIterable<RunEvent> {
        const result = await context.runTask?.({
          taskId: "task_coder_participant",
          targetAgentId: "coder",
          title: "Ask coder",
          instruction: "Handle a participant-scoped task.",
          expectedOutput: "A coder response",
          requiredCapabilities: ["implementation"],
          riskLevel: "low",
          dependsOn: [],
        }, {
          groupId: "group_primary_participant",
        })

        yield createRunEvent(context.runId, "message.completed", context.agent.id, {
          content: result?.summary ?? "",
        })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    const run = runManager.createRun({
      conversationId: "conv_primary_participant",
      mode: "group",
      participantAgentIds: ["orchestrator", "coder"],
      addressedAgentIds: [],
      userMessage: {
        role: "user",
        content: "Please delegate to coder.",
      },
      history: [],
    })

    await waitForTerminalRun(runManager, run.id)

    const completedRun = runManager.getRun(run.id)
    const events = runManager.getEvents(run.id) ?? []

    expect(completedRun?.status).toBe("completed")
    expect(events.some((event) => event.type === "task.completed" && event.taskId === "task_coder_participant")).toBe(true)
    expect(events.some((event) => event.type === "message.completed" && event.agentId === "coder")).toBe(true)
    expect(events.some((event) => event.type === "tool.completed" && event.toolName === "run_task")).toBe(true)
  })

  test("orchestrator cannot delegate to a primary agent outside the current group participants", async () => {
    const registry = await createInitializedRegistry()
    const providerService = {} as ProviderService
    const runManager = new RunManager(registry, providerService)

    ;(runManager as any).orchestratorExecutor = {
      executorType: "orchestrator",
      async *execute(context: {
        runId: string
        agent: { id: string }
        runTask?: (task: OrchestratorTask, options?: { groupId?: string; parentTaskId?: string }) => Promise<{
          status: "completed" | "failed" | "cancelled"
          summary: string
        }>
      }): AsyncIterable<RunEvent> {
        const result = await context.runTask?.({
          taskId: "task_coder_not_participant",
          targetAgentId: "coder",
          title: "Ask absent coder",
          instruction: "This should be rejected because coder is not a participant.",
          expectedOutput: "Nothing",
          requiredCapabilities: ["implementation"],
          riskLevel: "low",
          dependsOn: [],
        }, {
          groupId: "group_primary_rejected",
        })

        yield createRunEvent(context.runId, "message.completed", context.agent.id, {
          content: result?.summary ?? "",
        })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    const run = runManager.createRun({
      conversationId: "conv_primary_not_participant",
      mode: "group",
      participantAgentIds: ["orchestrator"],
      addressedAgentIds: [],
      userMessage: {
        role: "user",
        content: "Please delegate to coder.",
      },
      history: [],
    })

    await waitForTerminalRun(runManager, run.id)

    const completedRun = runManager.getRun(run.id)
    const events = runManager.getEvents(run.id) ?? []

    expect(completedRun?.status).toBe("completed")
    expect(events.some((event) => event.type === "task.failed" && event.taskId === "task_coder_not_participant")).toBe(true)
    expect(events.some((event) => event.type === "tool.failed" && event.toolName === "run_task")).toBe(true)
    expect(events.some((event) => event.agentId === "coder")).toBe(false)
  })

  test("orchestrator run surfaces run_task tool events through the real run pipeline", async () => {
    const registry = await createInitializedRegistry()
    const providerService = {} as ProviderService
    const runManager = new RunManager(registry, providerService)

    ;(runManager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: {
        runId: string
        agent: { id: string }
      }): AsyncIterable<RunEvent> {
        yield createRunEvent(context.runId, "message.completed", context.agent.id, {
          content: `${context.agent.id} handled the delegated task.`,
        })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    ;(runManager as any).orchestratorExecutor = {
      executorType: "orchestrator",
      async *execute(context: {
        runId: string
        agent: { id: string }
        runTask?: (task: OrchestratorTask, options?: { groupId?: string; parentTaskId?: string }) => Promise<{
          status: "completed" | "failed" | "cancelled"
          summary: string
        }>
      }): AsyncIterable<RunEvent> {
        const validTask: OrchestratorTask = {
          taskId: "task_valid",
          targetAgentId: "explore",
          title: "Collect context",
          instruction: "Gather context for the request.",
          expectedOutput: "Relevant context",
          requiredCapabilities: ["context"],
          riskLevel: "low",
          dependsOn: [],
        }

        const invalidTask: OrchestratorTask = {
          taskId: "task_invalid",
          targetAgentId: "missing-agent",
          title: "Impossible task",
          instruction: "This should fail.",
          expectedOutput: "Nothing",
          requiredCapabilities: [],
          riskLevel: "low",
          dependsOn: [],
        }

        const [validResult, invalidResult] = await Promise.all([
          context.runTask?.(validTask, {
            groupId: "group_smoke",
          }),
          context.runTask?.(invalidTask, {
            groupId: "group_smoke",
          }),
        ])

        yield createRunEvent(context.runId, "message.delta", context.agent.id, {
          delta: `${validResult?.summary ?? ""}\n${invalidResult?.summary ?? ""}`.trim(),
        })
        yield createRunEvent(context.runId, "message.completed", context.agent.id, {
          content: `${validResult?.summary ?? ""}\n${invalidResult?.summary ?? ""}`.trim(),
        })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    const run = runManager.createRun({
      conversationId: "conv_tool_smoke",
      mode: "group",
      participantAgentIds: ["orchestrator", "coder"],
      addressedAgentIds: [],
      userMessage: {
        role: "user",
        content: "Please delegate one successful and one failing task.",
      },
      history: [],
    })

    await waitForTerminalRun(runManager, run.id)

    const completedRun = runManager.getRun(run.id)
    const events = runManager.getEvents(run.id) ?? []

    expect(completedRun?.status).toBe("completed")
    expect(events.some((event) => event.type === "tool.started")).toBe(true)
    expect(events.some((event) => event.type === "tool.completed")).toBe(true)
    expect(events.some((event) => event.type === "tool.failed")).toBe(true)
    expect(events.some((event) => event.type === "task.completed" && event.taskId === "task_valid")).toBe(true)
    expect(events.some((event) => event.type === "task.failed" && event.taskId === "task_invalid")).toBe(true)

    const toolStartedEvents = events.filter((event) => event.type === "tool.started")
    expect(toolStartedEvents).toHaveLength(2)
    expect(new Set(toolStartedEvents.map((event) => event.toolCallId)).size).toBe(2)
    expect(toolStartedEvents.every((event) => event.toolName === "run_task")).toBe(true)
  })

  test("declared file locks block concurrent delegated tasks and release after completion", async () => {
    const registry = await createInitializedRegistry()
    const providerService = {} as ProviderService
    const runManager = new RunManager(registry, providerService)
    const workspaceRoot = await mkdtemp(join(tmpdir(), "agent-runtime-locks-"))

    ;(runManager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: {
        runId: string
        agent: { id: string }
        task?: { taskId: string }
      }): AsyncIterable<RunEvent> {
        if (context.task?.taskId === "task_lock_coder") {
          await sleep(40)
        }
        yield createRunEvent(context.runId, "agent.started", context.agent.id, {
          agentName: context.agent.id,
        })
        yield createRunEvent(context.runId, "message.completed", context.agent.id, {
          content: `${context.agent.id} handled ${context.task?.taskId ?? "task"}.`,
        })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    ;(runManager as any).orchestratorExecutor = {
      executorType: "orchestrator",
      async *execute(context: {
        runId: string
        agent: { id: string }
        runTask?: (task: OrchestratorTask, options?: { groupId?: string }) => Promise<{
          status: "completed" | "failed" | "cancelled"
          summary: string
        }>
      }): AsyncIterable<RunEvent> {
        const [coderResult, reviewerResult] = await Promise.all([
          context.runTask?.({
            taskId: "task_lock_coder",
            targetAgentId: "coder",
            title: "Edit app",
            instruction: "Edit src/App.tsx.",
            expectedOutput: "App edit",
            requiredCapabilities: ["implementation"],
            riskLevel: "medium",
            dependsOn: [],
            lockPaths: ["src/App.tsx"],
          }, {
            groupId: "group_lock_conflict",
          }),
          context.runTask?.({
            taskId: "task_lock_reviewer",
            targetAgentId: "reviewer",
            title: "Review app",
            instruction: "Also edit src/App.tsx.",
            expectedOutput: "Review edit",
            requiredCapabilities: ["review"],
            riskLevel: "medium",
            dependsOn: [],
            lockPaths: ["src/App.tsx"],
          }, {
            groupId: "group_lock_conflict",
          }),
        ])

        const retryResult = await context.runTask?.({
          taskId: "task_lock_retry",
          targetAgentId: "coder",
          title: "Retry app edit",
          instruction: "Retry src/App.tsx after the first task releases its lock.",
          expectedOutput: "Retry edit",
          requiredCapabilities: ["implementation"],
          riskLevel: "medium",
          dependsOn: [],
          lockPaths: ["src/App.tsx"],
        }, {
          groupId: "group_lock_conflict",
        })

        yield createRunEvent(context.runId, "message.completed", context.agent.id, {
          content: [
            coderResult?.status,
            reviewerResult?.status,
            retryResult?.status,
          ].join(","),
        })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    const run = runManager.createRun({
      conversationId: "conv_file_locks",
      mode: "group",
      participantAgentIds: ["orchestrator", "coder", "reviewer"],
      addressedAgentIds: [],
      userMessage: {
        role: "user",
        content: "Run two tasks that both want to edit src/App.tsx.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_file_locks",
        backendType: "local",
        rootPath: workspaceRoot,
      },
    })

    await waitForTerminalRun(runManager, run.id)

    const events = runManager.getEvents(run.id) ?? []
    const failedLockTask = events.find((event) =>
      event.type === "task.failed" &&
      (event.data as { code?: string }).code === "TASK_FILE_LOCK_CONFLICT"
    )
    const failedLockTaskId = failedLockTask?.taskId
    const failedLockTargetAgentId = (failedLockTask?.data as { details?: { targetAgentId?: string } })
      ?.details?.targetAgentId

    expect(runManager.getRun(run.id)?.status).toBe("completed")
    expect(failedLockTaskId).toBeTruthy()
    expect(events.some((event) => event.type === "tool.failed" && event.toolName === "run_task")).toBe(true)
    expect(events.some((event) => event.type === "task.completed" && event.taskId === "task_lock_retry")).toBe(true)
    expect(events.some((event) =>
      event.type === "agent.started" &&
      event.taskId === failedLockTaskId &&
      event.agentId === failedLockTargetAgentId
    )).toBe(false)
  })

  test("declared file locks fail fast when a run has no workspace", async () => {
    const registry = await createInitializedRegistry()
    const providerService = {} as ProviderService
    const runManager = new RunManager(registry, providerService)

    ;(runManager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: {
        runId: string
        agent: { id: string }
      }): AsyncIterable<RunEvent> {
        yield createRunEvent(context.runId, "agent.started", context.agent.id, {
          agentName: context.agent.id,
        })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    ;(runManager as any).orchestratorExecutor = {
      executorType: "orchestrator",
      async *execute(context: {
        runId: string
        agent: { id: string }
        runTask?: (task: OrchestratorTask) => Promise<{
          status: "completed" | "failed" | "cancelled"
          summary: string
        }>
      }): AsyncIterable<RunEvent> {
        const result = await context.runTask?.({
          taskId: "task_lock_without_workspace",
          targetAgentId: "coder",
          title: "Edit app without workspace",
          instruction: "This should not start because locks need a workspace.",
          expectedOutput: "Nothing",
          requiredCapabilities: ["implementation"],
          riskLevel: "medium",
          dependsOn: [],
          lockPaths: ["src/App.tsx"],
        })

        yield createRunEvent(context.runId, "message.completed", context.agent.id, {
          content: result?.summary ?? "",
        })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    const run = runManager.createRun({
      conversationId: "conv_file_locks_no_workspace",
      mode: "group",
      participantAgentIds: ["orchestrator", "coder"],
      addressedAgentIds: [],
      userMessage: {
        role: "user",
        content: "Run a task with declared file locks but no workspace.",
      },
      history: [],
    })

    await waitForTerminalRun(runManager, run.id)

    const events = runManager.getEvents(run.id) ?? []
    expect(events.some((event) =>
      event.type === "task.failed" &&
      event.taskId === "task_lock_without_workspace" &&
      (event.data as { code?: string }).code === "TASK_FILE_LOCK_WORKSPACE_NOT_BOUND"
    )).toBe(true)
    expect(events.some((event) =>
      event.type === "agent.started" &&
      event.taskId === "task_lock_without_workspace" &&
      event.agentId === "coder"
    )).toBe(false)
  })

  test("delegated subagents inherit the direct caller model source while keeping their own tools", async () => {
    const registry = await createInitializedRegistry()
    const providerService = {} as ProviderService
    const runManager = new RunManager(registry, providerService)
    const observed: Array<{
      agentId: string
      modelSourceAgentId?: string
      allowedTools: string[]
    }> = []

    ;(runManager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: {
        runId: string
        agent: { id: string; allowedTools: string[] }
        modelSourceAgent?: { id: string }
      }): AsyncIterable<RunEvent> {
        observed.push({
          agentId: context.agent.id,
          modelSourceAgentId: context.modelSourceAgent?.id,
          allowedTools: context.agent.allowedTools,
        })
        yield createRunEvent(context.runId, "message.completed", context.agent.id, {
          content: `${context.agent.id} completed`,
        })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    ;(runManager as any).orchestratorExecutor = {
      executorType: "orchestrator",
      async *execute(context: {
        runId: string
        agent: { id: string }
        runTask?: (task: OrchestratorTask) => Promise<{
          status: "completed" | "failed" | "cancelled"
          summary: string
        }>
      }): AsyncIterable<RunEvent> {
        const result = await context.runTask?.({
          taskId: "task_file_subagent",
          targetAgentId: "file",
          title: "Edit a file",
          instruction: "Prepare a file edit.",
          expectedOutput: "A file edit result",
          requiredCapabilities: ["file-write"],
          riskLevel: "medium",
          dependsOn: [],
        })

        yield createRunEvent(context.runId, "message.completed", context.agent.id, {
          content: result?.summary ?? "",
        })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    const run = runManager.createRun({
      conversationId: "conv_subagent_model_source",
      mode: "group",
      participantAgentIds: ["orchestrator"],
      addressedAgentIds: [],
      userMessage: {
        role: "user",
        content: "Ask the file subagent to prepare an edit.",
      },
      history: [],
    })

    await waitForTerminalRun(runManager, run.id)

    const fileExecution = observed.find((entry) => entry.agentId === "file")
    expect(runManager.getRun(run.id)?.status).toBe("completed")
    expect(fileExecution?.modelSourceAgentId).toBe("orchestrator")
    expect(fileExecution?.allowedTools).toEqual(expect.arrayContaining(["write_file", "edit_file"]))
    expect(fileExecution?.allowedTools).not.toContain("run_task")
  })
})
