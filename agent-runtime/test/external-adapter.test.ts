import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentRegistry } from "../src/agents"
import {
  RunManager,
  ExternalAdapterExecutor,
  FakeOpenCodeClient,
  OpenCodeAdapter,
  createDefaultRuntimeToolRegistry,
  createRunEvent,
  type ExternalSessionLink,
  type OpenCodeClient,
  type OpenCodePromptRequest,
  type OpenCodeSessionRequest,
  type OrchestratorTask,
  type RunEvent,
} from "../src/runtime"
import type { ProviderService } from "../src/provider"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createInitializedRegistry(): Promise<AgentRegistry> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-external-adapter-"))
  const registry = new AgentRegistry(dataDir, createDefaultRuntimeToolRegistry())
  await registry.initialize()
  return registry
}

async function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "agent-runtime-opencode-workspace-"))
}

function attachOpenCodeClient(runManager: RunManager, client: OpenCodeClient): void {
  ;(runManager as any).externalAdapterExecutor = new ExternalAdapterExecutor({
    registry: {
      getAdapter(provider: string) {
        return provider === "opencode" ? new OpenCodeAdapter(client) : null
      },
    },
  })
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

async function waitForEvent(
  runManager: RunManager,
  runId: string,
  predicate: (event: RunEvent) => boolean
): Promise<RunEvent> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const event = (runManager.getEvents(runId) ?? []).find(predicate)
    if (event) {
      return event
    }

    await sleep(10)
  }

  throw new Error(`Timed out waiting for event in run ${runId}`)
}

class AbortAwareOpenCodeClient implements OpenCodeClient {
  aborted = false

  async ensureSession(request: OpenCodeSessionRequest): Promise<ExternalSessionLink> {
    return {
      provider: "opencode",
      agentId: request.agentId,
      scope: request.scope,
      providerSessionId: "abort_aware_session",
      conversationId: request.conversationId,
      workspaceId: request.workspaceId,
      taskId: request.taskId,
      runId: request.runId,
    }
  }

  async *streamPrompt(request: OpenCodePromptRequest) {
    yield {
      type: "message.delta" as const,
      delta: "OpenCode fake adapter is waiting.",
    }

    await new Promise<void>((resolve) => {
      if (request.signal.aborted) {
        this.aborted = true
        resolve()
        return
      }

      request.signal.addEventListener("abort", () => {
        this.aborted = true
        resolve()
      }, { once: true })
    })

    if (request.signal.aborted) {
      return
    }

    yield {
      type: "message.completed" as const,
      content: "This should not be emitted after cancellation.",
    }
  }
}

class PromptCapturingOpenCodeClient extends FakeOpenCodeClient {
  prompts: OpenCodePromptRequest[] = []

  async *streamPrompt(request: OpenCodePromptRequest) {
    this.prompts.push(request)
    yield* super.streamPrompt(request)
  }
}

describe("external adapter executor", () => {
  test("direct OpenCode run uses the external adapter instead of the mock executor", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    attachOpenCodeClient(runManager, new FakeOpenCodeClient())
    const rootPath = await createWorkspace()

    const run = runManager.createRun({
      conversationId: "conv_opencode_direct",
      mode: "single",
      participantAgentIds: ["opencode"],
      addressedAgentIds: ["opencode"],
      userMessage: {
        role: "user",
        content: "Inspect the workspace.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_opencode_direct",
        backendType: "local",
        rootPath,
      },
    })

    await waitForTerminalRun(runManager, run.id)

    const completedRun = runManager.getRun(run.id)
    const events = runManager.getEvents(run.id) ?? []
    const started = events.find((event) => event.type === "agent.started" && event.agentId === "opencode")
    const message = events.find((event) => event.type === "message.completed" && event.agentId === "opencode")

    expect(completedRun?.status).toBe("completed")
    expect((started?.data as { externalSession?: { scope?: string; providerSessionId?: string } }).externalSession?.scope)
      .toBe("conversation-visible")
    expect((started?.data as { externalSession?: { providerSessionId?: string } }).externalSession?.providerSessionId)
      .toStartWith("fake_opencode_")
    expect((message?.data as { content?: string }).content).toContain("OpenCode fake adapter received")
    expect((message?.data as { content?: string }).content).not.toBe("OpenCode received the task.")
    expect((message?.data as {
      externalModel?: { provider?: string; providerId?: string; modelId?: string }
    }).externalModel).toEqual({
      provider: "opencode",
      providerId: "fake-provider",
      modelId: "fake-model",
    })
    expect(message?.messageIndex).toBe(0)
  })

  test("direct OpenCode group run prepends AgentHub external context", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    const client = new PromptCapturingOpenCodeClient()
    attachOpenCodeClient(runManager, client)
    const rootPath = await createWorkspace()

    const run = runManager.createRun({
      conversationId: "conv_opencode_context",
      mode: "group",
      participantAgentIds: ["orchestrator", "opencode"],
      addressedAgentIds: ["opencode"],
      userMessage: {
        role: "user",
        content: "Continue from that result.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_opencode_context",
        backendType: "local",
        rootPath,
      },
      externalContext: [{
        provider: "opencode",
        agentId: "opencode",
        scope: "conversation-visible",
        mode: "delta",
        messages: [{
          id: "msg_visible_user",
          role: "user",
          senderLabel: "user",
          createdAt: "2026-06-02T00:00:00.000Z",
          content: "Earlier visible request.",
        }, {
          id: "msg_visible_coder",
          role: "assistant",
          agentId: "coder",
          senderLabel: "coder",
          createdAt: "2026-06-02T00:01:00.000Z",
          content: "Coder explained the current bug.",
        }],
        handoffSummaries: [{
          sessionId: "eas_task_context",
          providerSessionId: "ses_task_context",
          taskId: "task_context",
          runId: "run_context",
          summary: "OpenCode previously edited src/index.ts.",
        }],
        cursorCandidate: {
          throughMessageId: "msg_visible_coder",
          throughMessageCreatedAt: "2026-06-02T00:01:00.000Z",
          includedMessageIds: ["msg_visible_user", "msg_visible_coder"],
          includedHandoffSessionIds: ["eas_task_context"],
        },
      }],
    })

    await waitForTerminalRun(runManager, run.id)

    const prompt = client.prompts[0]?.prompt.content ?? ""
    const events = runManager.getEvents(run.id) ?? []
    const completed = events.find((event) => event.type === "agent.completed" && event.agentId === "opencode")
    const completedData = completed?.data as {
      externalContext?: Record<string, unknown>
    }

    expect(prompt).toContain("AgentHub visible context (delta).")
    expect(prompt).toContain("Earlier visible request.")
    expect(prompt).toContain("Coder explained the current bug.")
    expect(prompt).toContain("OpenCode previously edited src/index.ts.")
    expect(prompt).toContain("Current user request:")
    expect(prompt).toContain("Continue from that result.")
    expect(client.prompts[0]?.executionAgent).toBe("build")
    expect(completedData.externalContext).toEqual({
      provider: "opencode",
      agentId: "opencode",
      scope: "conversation-visible",
      mode: "delta",
      messageCount: 2,
      handoffSummaryCount: 1,
      cursorCandidate: {
        throughMessageId: "msg_visible_coder",
        throughMessageCreatedAt: "2026-06-02T00:01:00.000Z",
        includedMessageIds: ["msg_visible_user", "msg_visible_coder"],
        includedHandoffSessionIds: ["eas_task_context"],
      },
      omitted: undefined,
    })
  })

  test("direct OpenCode run reuses a conversation-visible session hint", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    attachOpenCodeClient(runManager, new FakeOpenCodeClient())
    const rootPath = await createWorkspace()

    const run = runManager.createRun({
      conversationId: "conv_opencode_reuse",
      mode: "single",
      participantAgentIds: ["opencode"],
      addressedAgentIds: ["opencode"],
      userMessage: {
        role: "user",
        content: "Continue the prior session.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_opencode_reuse",
        backendType: "local",
        rootPath,
      },
      externalSessionHints: [{
        provider: "opencode",
        agentId: "opencode",
        scope: "conversation-visible",
        providerSessionId: "provider_session_existing",
        conversationId: "conv_opencode_reuse",
        workspaceId: "workspace_opencode_reuse",
      }],
    })

    await waitForTerminalRun(runManager, run.id)

    const events = runManager.getEvents(run.id) ?? []
    const started = events.find((event) => event.type === "agent.started" && event.agentId === "opencode")

    expect((started?.data as { externalSession?: { providerSessionId?: string } }).externalSession?.providerSessionId)
      .toBe("provider_session_existing")
  })

  test("delegated OpenCode task keeps task identity on visible message events", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    attachOpenCodeClient(runManager, new FakeOpenCodeClient())
    const rootPath = await createWorkspace()

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
        const result = await context.runTask?.({
          taskId: "task_opencode_delegated",
          targetAgentId: "opencode",
          title: "Ask OpenCode",
          instruction: "Use OpenCode for this delegated task.",
          expectedOutput: "An OpenCode response",
          requiredCapabilities: ["external-agent"],
          riskLevel: "low",
          dependsOn: [],
        }, {
          groupId: "group_opencode_delegated",
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
      conversationId: "conv_opencode_delegated",
      mode: "group",
      participantAgentIds: ["orchestrator", "opencode"],
      addressedAgentIds: [],
      userMessage: {
        role: "user",
        content: "Delegate to OpenCode.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_opencode_delegated",
        backendType: "local",
        rootPath,
      },
    })

    await waitForTerminalRun(runManager, run.id)

    const completedRun = runManager.getRun(run.id)
    const events = runManager.getEvents(run.id) ?? []
    const started = events.find((event) => event.type === "agent.started" && event.agentId === "opencode")
    const message = events.find((event) => event.type === "message.completed" && event.agentId === "opencode")
    const agentCompleted = events.find((event) => event.type === "agent.completed" && event.agentId === "opencode")
    const completedData = agentCompleted?.data as {
      handoffSummary?: string
      externalSession?: { handoffSummary?: string }
    }

    expect(completedRun?.status).toBe("completed")
    expect((started?.data as { externalSession?: { scope?: string; taskId?: string } }).externalSession?.scope)
      .toBe("delegated-task")
    expect((started?.data as { externalSession?: { taskId?: string } }).externalSession?.taskId)
      .toBe("task_opencode_delegated")
    expect(message?.taskId).toBe("task_opencode_delegated")
    expect(message?.parentAgentId).toBe("orchestrator")
    expect(message?.groupId).toBe("group_opencode_delegated")
    expect((message?.data as { content?: string }).content)
      .toContain("OpenCode fake adapter completed delegated task")
    expect((message?.data as {
      externalModel?: { provider?: string; providerId?: string; modelId?: string }
    }).externalModel).toEqual({
      provider: "opencode",
      providerId: "fake-provider",
      modelId: "fake-model",
    })
    expect(events.some((event) => event.type === "task.completed" && event.taskId === "task_opencode_delegated"))
      .toBe(true)
    expect(completedData.handoffSummary).toContain("OpenCode completed delegated task \"Ask OpenCode\".")
    expect(completedData.handoffSummary).toContain("Visible response:")
    expect(completedData.handoffSummary).not.toContain("Use OpenCode for this delegated task.")
    expect(completedData.externalSession?.handoffSummary).toBe(completedData.handoffSummary)
  })

  test("OpenCode adapter fails clearly without a bound workspace", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)

    const run = runManager.createRun({
      conversationId: "conv_opencode_missing_workspace",
      mode: "single",
      participantAgentIds: ["opencode"],
      addressedAgentIds: ["opencode"],
      userMessage: {
        role: "user",
        content: "Inspect the workspace.",
      },
      history: [],
    })

    await waitForTerminalRun(runManager, run.id)

    const failedRun = runManager.getRun(run.id)
    const events = runManager.getEvents(run.id) ?? []

    expect(failedRun?.status).toBe("failed")
    expect(failedRun?.error?.code).toBe("ADAPTER_WORKSPACE_REQUIRED")
    expect(events.some((event) => event.type === "run.failed" && event.data && typeof event.data === "object" &&
      (event.data as { code?: string }).code === "ADAPTER_WORKSPACE_REQUIRED")).toBe(true)
  })

  test("cancelling an OpenCode run aborts the adapter stream and emits a terminal event", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    const rootPath = await createWorkspace()
    const client = new AbortAwareOpenCodeClient()
    attachOpenCodeClient(runManager, client)

    const run = runManager.createRun({
      conversationId: "conv_opencode_cancel",
      mode: "single",
      participantAgentIds: ["opencode"],
      addressedAgentIds: ["opencode"],
      userMessage: {
        role: "user",
        content: "Start a long OpenCode task.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_opencode_cancel",
        backendType: "local",
        rootPath,
      },
    })

    await waitForEvent(runManager, run.id, (event) =>
      event.type === "message.delta" && event.agentId === "opencode"
    )

    await runManager.cancelRun(run.id)
    await waitForTerminalRun(runManager, run.id)

    const completedRun = runManager.getRun(run.id)
    const events = runManager.getEvents(run.id) ?? []

    expect(client.aborted).toBe(true)
    expect(completedRun?.status).toBe("cancelled")
    expect(events.some((event) => event.type === "run.cancelled")).toBe(true)
    expect(events.some((event) =>
      event.type === "message.completed" &&
      (event.data as { content?: string }).content === "This should not be emitted after cancellation."
    )).toBe(false)
  })
})
