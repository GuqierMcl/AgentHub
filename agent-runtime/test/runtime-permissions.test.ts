import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { ModelMessage } from "ai"
import { AgentRegistry } from "../src/agents"
import { createDefaultRuntimeToolRegistry, createRunEvent, RunManager, type AgentExecutionContext, type RunEvent } from "../src/runtime"
import type { OrchestratorTask } from "../src/runtime"
import runsRouter from "../src/routers/runs"
import type { ProviderService } from "../src/provider"

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createHarness(): Promise<{ app: Hono; manager: RunManager }> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-permission-"))
  const tools = createDefaultRuntimeToolRegistry()
  const registry = new AgentRegistry(dataDir, tools)
  await registry.initialize()
  const manager = new RunManager(registry, {} as ProviderService, undefined, tools)

  ;(manager as any).aiSdkExecutor = {
    executorType: "ai-sdk",
    async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
      if (!context.resumeMessages) {
        const toolContext = {
          ...context,
          toolCallId: "tool_external_read",
          emitEvent: context.emitEvent ?? (() => {}),
        }
        context.permissionService?.stageToolApproval(toolContext, "read_file", {
          reason: "Read an explicitly selected external file",
          riskLevel: "medium",
        })
        context.permissionService?.bindAiSdkApproval(context.runId, "tool_external_read", "approval_external_read")
        context.onApprovalPending?.([{
          role: "assistant",
          content: [{
            type: "tool-approval-request",
            approvalId: "approval_external_read",
            toolCall: {
              type: "tool-call",
              toolCallId: "tool_external_read",
              toolName: "read_file",
              input: { path: "../external/note.txt" },
            },
          }],
        } as unknown as ModelMessage])
        return
      }

      yield createRunEvent(context.runId, "message.completed", context.agent.id, {
        content: "Approval decision received.",
      })
      yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
        status: "completed",
      })
    },
  }

  const app = new Hono()
  app.use("*", async (c: Context, next: Next) => {
    c.set("agentRegistry", registry)
    c.set("runManager", manager)
    await next()
  })
  app.route("/", runsRouter)
  return { app, manager }
}

async function createWaitingRun(app: Hono, manager: RunManager): Promise<string> {
  const response = await app.request("/runtime/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      conversationId: "conv_permission",
      mode: "single",
      participantAgentIds: ["coder"],
      addressedAgentIds: ["coder"],
      userMessage: { role: "user", content: "Read the selected file." },
      history: [],
    }),
  })
  const body = await response.json() as { runId: string }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (manager.getRun(body.runId)?.status === "waiting_approval") {
      return body.runId
    }
    await sleep(5)
  }
  throw new Error("Run did not enter waiting_approval")
}

describe("Runtime permissions", () => {
  test("lists pending requests and resumes the same run after approval", async () => {
    const { app, manager } = await createHarness()
    const runId = await createWaitingRun(app, manager)

    const listResponse = await app.request(`/runtime/runs/${runId}/permissions`)
    const list = await listResponse.json() as { permissions: Array<{ requestId: string; toolCallId: string }> }
    expect(listResponse.status).toBe(200)
    expect(list.permissions).toHaveLength(1)
    expect(list.permissions[0]?.toolCallId).toBe("tool_external_read")

    const decisionResponse = await app.request(
      `/runtime/runs/${runId}/permissions/${list.permissions[0]?.requestId}/decision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: true, reason: "Approved for this run" }),
      }
    )
    expect(decisionResponse.status).toBe(200)

    await sleep(20)
    expect(manager.getRun(runId)?.status).toBe("completed")
    const events = manager.getEvents(runId) ?? []
    expect(events.some((event) => event.type === "permission.requested")).toBe(true)
    expect(events.some((event) => event.type === "permission.approved")).toBe(true)
    expect(events.some((event) => event.type === "run.completed")).toBe(true)
  })

  test("denial produces a structured tool failure and cancellation closes pending permissions", async () => {
    const deniedHarness = await createHarness()
    const deniedRunId = await createWaitingRun(deniedHarness.app, deniedHarness.manager)
    const deniedRequest = deniedHarness.manager.listPermissions(deniedRunId)[0]!
    await deniedHarness.app.request(`/runtime/runs/${deniedRunId}/permissions/${deniedRequest.requestId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: false, reason: "Not allowed" }),
    })
    await sleep(20)
    const deniedEvents = deniedHarness.manager.getEvents(deniedRunId) ?? []
    expect(deniedEvents.some((event) => event.type === "permission.denied")).toBe(true)
    expect(deniedEvents.some((event) =>
      event.type === "tool.failed" &&
      (event.data as { error?: { code?: string } }).error?.code === "TOOL_EXECUTION_DENIED"
    )).toBe(true)

    const cancelledHarness = await createHarness()
    const cancelledRunId = await createWaitingRun(cancelledHarness.app, cancelledHarness.manager)
    await cancelledHarness.manager.cancelRun(cancelledRunId)
    expect(cancelledHarness.manager.getRun(cancelledRunId)?.status).toBe("cancelled")
    expect(cancelledHarness.manager.getEvents(cancelledRunId)?.some((event) => event.type === "permission.cancelled")).toBe(true)
  })

  test("resumes an approval requested by a delegated task branch", async () => {
    const { app, manager } = await createHarness()
    ;(manager as any).orchestratorExecutor = {
      executorType: "orchestrator",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        const result = await context.runTask?.({
          taskId: "task_child_permission",
          targetAgentId: "coder",
          title: "Read selected file",
          instruction: "Read an approved file.",
          expectedOutput: "Content",
          requiredCapabilities: [],
          riskLevel: "medium",
          dependsOn: [],
        } satisfies OrchestratorTask)
        yield createRunEvent(context.runId, "message.completed", context.agent.id, {
          content: result?.summary ?? "",
        })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, { status: "completed" })
      },
    }

    const response = await app.request("/runtime/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: "conv_delegated_permission",
        mode: "group",
        participantAgentIds: ["orchestrator", "coder"],
        addressedAgentIds: [],
        userMessage: { role: "user", content: "Delegate a read." },
        history: [],
      }),
    })
    const { runId } = await response.json() as { runId: string }
    for (let attempt = 0; attempt < 50 && manager.getRun(runId)?.status !== "waiting_approval"; attempt += 1) {
      await sleep(5)
    }
    const request = manager.listPermissions(runId)[0]!
    expect(request.taskId).toBe("task_child_permission")

    await app.request(`/runtime/runs/${runId}/permissions/${request.requestId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: true }),
    })
    await sleep(30)

    const events = manager.getEvents(runId) ?? []
    expect(manager.getRun(runId)?.status).toBe("completed")
    expect(events.some((event) => event.type === "task.completed" && event.taskId === "task_child_permission")).toBe(true)
    expect(events.some((event) => event.type === "permission.approved" && event.taskId === "task_child_permission")).toBe(true)
  })

  test("waits for all approvals from one execution frame before resuming", async () => {
    const { app, manager } = await createHarness()
    let executions = 0
    ;(manager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        executions += 1
        if (!context.resumeMessages) {
          for (const suffix of ["first", "second"]) {
            const toolCallId = `tool_${suffix}`
            const toolContext = {
              ...context,
              toolCallId,
              emitEvent: context.emitEvent ?? (() => {}),
            }
            context.permissionService?.stageToolApproval(toolContext, "read_file", {
              reason: `Approve ${suffix}`,
              riskLevel: "medium",
            })
            context.permissionService?.bindAiSdkApproval(context.runId, toolCallId, `approval_${suffix}`)
          }
          context.onApprovalPending?.([{
            role: "assistant",
            content: [],
          } as unknown as ModelMessage])
          return
        }
        yield createRunEvent(context.runId, "message.completed", context.agent.id, { content: "resumed" })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, { status: "completed" })
      },
    }

    const runId = await createWaitingRun(app, manager)
    const requests = manager.listPermissions(runId)
    expect(requests).toHaveLength(2)
    await app.request(`/runtime/runs/${runId}/permissions/${requests[0]!.requestId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: true }),
    })
    await sleep(10)
    expect(manager.getRun(runId)?.status).toBe("waiting_approval")
    expect(executions).toBe(1)

    await app.request(`/runtime/runs/${runId}/permissions/${requests[1]!.requestId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: false }),
    })
    await sleep(20)
    expect(manager.getRun(runId)?.status).toBe("completed")
    expect(executions).toBe(2)
  })

  test("keeps a run running while one delegated branch waits and another branch is still active", async () => {
    const { app, manager } = await createHarness()
    ;(manager as any).orchestratorExecutor = {
      executorType: "orchestrator",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        const waitTask: OrchestratorTask = {
          taskId: "task_waiting_branch",
          targetAgentId: "coder",
          title: "Read selected file",
          instruction: "Wait for approval.",
          expectedOutput: "Approved read result",
          requiredCapabilities: [],
          riskLevel: "medium",
          dependsOn: [],
        }
        const activeTask: OrchestratorTask = {
          taskId: "task_active_branch",
          targetAgentId: "coder",
          title: "Continue independent work",
          instruction: "Keep working while the other branch waits.",
          expectedOutput: "Independent result",
          requiredCapabilities: [],
          riskLevel: "low",
          dependsOn: [],
        }
        const results = await Promise.all([
          context.runTask?.(waitTask),
          context.runTask?.(activeTask),
        ])
        yield createRunEvent(context.runId, "message.completed", context.agent.id, {
          content: results.map((result) => result?.summary ?? "").join("\n"),
        })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, { status: "completed" })
      },
    }
    ;(manager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        if (context.task?.taskId === "task_waiting_branch" && !context.resumeMessages) {
          const toolCallId = "tool_waiting_branch"
          const toolContext = {
            ...context,
            toolCallId,
            emitEvent: context.emitEvent ?? (() => {}),
          }
          context.permissionService?.stageToolApproval(toolContext, "read_file", {
            reason: "Approve waiting branch",
            riskLevel: "medium",
          })
          context.permissionService?.bindAiSdkApproval(context.runId, toolCallId, "approval_waiting_branch")
          context.onApprovalPending?.([{
            role: "assistant",
            content: [],
          } as unknown as ModelMessage])
          return
        }

        if (context.task?.taskId === "task_active_branch") {
          await sleep(500)
        }

        yield createRunEvent(context.runId, "message.completed", context.agent.id, {
          content: `${context.task?.taskId ?? "entry"} completed`,
        })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, { status: "completed" })
      },
    }

    const response = await app.request("/runtime/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: "conv_parallel_permission",
        mode: "group",
        participantAgentIds: ["orchestrator", "coder"],
        addressedAgentIds: [],
        userMessage: { role: "user", content: "Run two branches." },
        history: [],
      }),
    })
    const { runId } = await response.json() as { runId: string }
    for (let attempt = 0; attempt < 50 && manager.listPermissions(runId).length === 0; attempt += 1) {
      await sleep(5)
    }

    expect(manager.listPermissions(runId)).toHaveLength(1)
    expect(manager.getRun(runId)?.status).toBe("running")

    await sleep(550)
    expect(manager.getRun(runId)?.status).toBe("waiting_approval")

    const request = manager.listPermissions(runId)[0]!
    await app.request(`/runtime/runs/${runId}/permissions/${request.requestId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: true }),
    })
    for (let attempt = 0; attempt < 50 && manager.getRun(runId)?.status !== "completed"; attempt += 1) {
      await sleep(5)
    }
    expect(manager.getRun(runId)?.status).toBe("completed")
  })
})
