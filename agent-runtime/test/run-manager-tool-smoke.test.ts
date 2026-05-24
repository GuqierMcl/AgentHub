import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentRegistry } from "../src/agents"
import { RunManager, createRunEvent, type OrchestratorTask, type RunEvent } from "../src/runtime"
import type { ProviderService } from "../src/provider"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createInitializedRegistry(): Promise<AgentRegistry> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-run-smoke-"))
  const registry = new AgentRegistry(dataDir)
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
  test("orchestrator run surfaces run_task tool events through the real run pipeline", async () => {
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
})
