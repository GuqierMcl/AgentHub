import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentRegistry } from "../src/agents"
import {
  RunManager,
  ClaudeCodeAdapter,
  CodexAdapter,
  ExternalAdapterExecutor,
  FakeClaudeCodeClient,
  FakeCodexClient,
  FakeOpenCodeClient,
  OpenCodeAdapter,
  createDefaultRuntimeToolRegistry,
  createRunEvent,
  type ClaudeCodeClient,
  type ClaudeCodePromptRequest,
  type CodexClient,
  type CodexPromptRequest,
  type CodexSessionRequest,
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

function attachClaudeCodeClient(runManager: RunManager, client: ClaudeCodeClient): void {
  ;(runManager as any).externalAdapterExecutor = new ExternalAdapterExecutor({
    registry: {
      getAdapter(provider: string) {
        return provider === "claude-code" ? new ClaudeCodeAdapter(client) : null
      },
    },
  })
}

function attachCodexClient(runManager: RunManager, client: CodexClient): void {
  ;(runManager as any).externalAdapterExecutor = new ExternalAdapterExecutor({
    registry: {
      getAdapter(provider: string) {
        return provider === "codex" ? new CodexAdapter(client) : null
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

class ToolStreamingOpenCodeClient extends FakeOpenCodeClient {
  async *streamPrompt(_request: OpenCodePromptRequest) {
    yield {
      type: "tool.started",
      providerEventId: "evt_tool_called",
      providerToolCallId: "call_edit",
      providerToolName: "edit",
      input: {
        file: "src/index.ts",
      },
    } as any
    yield {
      type: "tool.completed",
      providerEventId: "evt_tool_success",
      providerToolCallId: "call_edit",
      providerToolName: "edit",
      output: {
        content: "Updated src/index.ts",
      },
    } as any
    yield {
      type: "message.delta" as const,
      delta: "Edited src/index.ts.",
    }
    yield {
      type: "message.completed" as const,
      content: "Edited src/index.ts.",
      externalModel: {
        provider: "opencode",
        providerId: "fake-provider",
        modelId: "fake-model",
      },
    }
  }
}

class PermissionStreamingOpenCodeClient extends FakeOpenCodeClient {
  async *streamPrompt(request: OpenCodePromptRequest) {
    const decision = await (request as any).permissionHandler?.({
      providerPermissionId: "perm_edit",
      permissionKind: "edit",
      patterns: ["src/index.ts"],
      providerToolCallId: "call_edit",
      providerMessageId: "msg_opencode",
      providerMetadata: { source: "opencode" },
      reason: "OpenCode wants to edit src/index.ts",
    })
    const content = decision?.approved
      ? "Permission approved; edit completed."
      : "Permission denied; edit skipped."
    yield {
      type: "message.delta" as const,
      delta: content,
    }
    yield {
      type: "message.completed" as const,
      content,
    }
  }
}

class ToolStreamingClaudeCodeClient extends FakeClaudeCodeClient {
  async *streamPrompt(_request: ClaudeCodePromptRequest) {
    yield {
      type: "tool.started",
      providerToolCallId: "toolu_edit",
      providerToolName: "Edit",
      input: {
        file_path: "src/index.ts",
      },
    } as any
    yield {
      type: "tool.completed",
      providerToolCallId: "toolu_edit",
      providerToolName: "Edit",
      output: {
        content: "Updated src/index.ts",
      },
    } as any
    yield {
      type: "message.delta" as const,
      delta: "Edited src/index.ts.",
    }
    yield {
      type: "message.completed" as const,
      content: "Edited src/index.ts.",
      externalModel: {
        provider: "claude-code",
        providerId: "anthropic",
        modelId: "claude-sonnet-4-5",
      },
    }
  }
}

class PermissionStreamingClaudeCodeClient extends FakeClaudeCodeClient {
  async *streamPrompt(request: ClaudeCodePromptRequest) {
    const decision = await (request as any).permissionHandler?.({
      providerPermissionId: "perm_edit",
      permissionKind: "Edit",
      providerToolCallId: "toolu_edit",
      providerMetadata: { source: "claude-code" },
      reason: "Claude Code wants to edit src/index.ts",
      input: {
        file_path: "src/index.ts",
      },
    })
    const content = decision?.approved
      ? "Permission approved; edit completed."
      : "Permission denied; edit skipped."
    yield {
      type: "message.delta" as const,
      delta: content,
    }
    yield {
      type: "message.completed" as const,
      content,
    }
  }
}

class QuestionAskingClaudeCodeClient extends FakeClaudeCodeClient {
  async *streamPrompt(request: ClaudeCodePromptRequest) {
    const answers = await (request as any).questionHandler?.({
      providerQuestionId: "ask_approach",
      providerToolCallId: "ask_user_question",
      providerMetadata: { source: "claude-code" },
      questions: [{
        id: "approach",
        title: "Choose an approach",
        body: "Which implementation approach should Claude Code use?",
        options: [{ id: "minimal", label: "Minimal" }],
        allowCustom: true,
        required: true,
      }],
    })
    const answer = answers?.[0]?.answer ?? "unknown"
    yield {
      type: "message.delta" as const,
      delta: `User chose ${answer}.`,
    }
    yield {
      type: "message.completed" as const,
      content: `User chose ${answer}.`,
    }
  }
}

class PromptCapturingCodexClient extends FakeCodexClient {
  prompts: CodexPromptRequest[] = []

  async *streamPrompt(request: CodexPromptRequest) {
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

  test("direct OpenCode tool events reuse the assistant message identity", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    attachOpenCodeClient(runManager, new ToolStreamingOpenCodeClient())
    const rootPath = await createWorkspace()

    const run = runManager.createRun({
      conversationId: "conv_opencode_tool_events",
      mode: "single",
      participantAgentIds: ["opencode"],
      addressedAgentIds: ["opencode"],
      userMessage: {
        role: "user",
        content: "Edit the file.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_opencode_tool_events",
        backendType: "local",
        rootPath,
      },
    })

    await waitForTerminalRun(runManager, run.id)

    const events = runManager.getEvents(run.id) ?? []
    const message = events.find((event) => event.type === "message.completed" && event.agentId === "opencode")
    const toolStarted = events.find((event) => event.type === "tool.started" && event.agentId === "opencode")
    const toolCompleted = events.find((event) => event.type === "tool.completed" && event.agentId === "opencode")

    expect(toolStarted?.messageId).toBe(message?.messageId)
    expect(toolCompleted?.messageId).toBe(message?.messageId)
    expect(toolStarted?.toolCallId).toBe("opencode:call_edit")
    expect(toolStarted?.toolName).toBe("edit")
    expect((toolStarted?.data as { externalProvider?: string; providerToolCallId?: string }).externalProvider)
      .toBe("opencode")
    expect((toolStarted?.data as { providerToolCallId?: string }).providerToolCallId)
      .toBe("call_edit")
    expect((toolCompleted?.data as { output?: { content?: string } }).output?.content)
      .toBe("Updated src/index.ts")
  })

  test("direct OpenCode permission requests attach to the same chat message and resolve through Runtime decisions", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    attachOpenCodeClient(runManager, new PermissionStreamingOpenCodeClient())
    const rootPath = await createWorkspace()

    const run = runManager.createRun({
      conversationId: "conv_opencode_permission",
      mode: "single",
      participantAgentIds: ["opencode"],
      addressedAgentIds: ["opencode"],
      userMessage: {
        role: "user",
        content: "Edit src/index.ts.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_opencode_permission",
        backendType: "local",
        rootPath,
      },
    })

    const requested = await waitForEvent(runManager, run.id, (event) => event.type === "permission.requested")
    expect(requested.messageId).toBeDefined()
    expect(requested.toolCallId).toBe("opencode:call_edit")
    expect((requested.data as { data?: { providerPermissionId?: string } }).data?.providerPermissionId)
      .toBe("perm_edit")

    const decision = runManager.decidePermission(
      run.id,
      (requested.data as { requestId: string }).requestId,
      true,
      "Approved once"
    )
    expect(decision.status).toBe("approved")

    await waitForTerminalRun(runManager, run.id)
    const events = runManager.getEvents(run.id) ?? []
    const message = events.find((event) => event.type === "message.completed")
    const approved = events.find((event) => event.type === "permission.approved")
    expect(message?.messageId).toBe(requested.messageId)
    expect(approved?.messageId).toBe(requested.messageId)
    expect((message?.data as { content?: string }).content).toContain("Permission approved")
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

  test("delegated OpenCode tool events keep delegated task identity", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    attachOpenCodeClient(runManager, new ToolStreamingOpenCodeClient())
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
        await context.runTask?.({
          taskId: "task_opencode_tool_events",
          targetAgentId: "opencode",
          title: "Ask OpenCode to edit",
          instruction: "Use OpenCode for this delegated edit.",
          expectedOutput: "An OpenCode response",
          requiredCapabilities: ["external-agent"],
          riskLevel: "low",
          dependsOn: [],
        }, {
          groupId: "group_opencode_tool_events",
        })

        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    const run = runManager.createRun({
      conversationId: "conv_opencode_delegated_tool_events",
      mode: "group",
      participantAgentIds: ["orchestrator", "opencode"],
      addressedAgentIds: [],
      userMessage: {
        role: "user",
        content: "Delegate an edit to OpenCode.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_opencode_delegated_tool_events",
        backendType: "local",
        rootPath,
      },
    })

    await waitForTerminalRun(runManager, run.id)

    const events = runManager.getEvents(run.id) ?? []
    const message = events.find((event) => event.type === "message.completed" && event.agentId === "opencode")
    const toolStarted = events.find((event) => event.type === "tool.started" && event.agentId === "opencode")

    expect(toolStarted?.messageId).toBe(message?.messageId)
    expect(toolStarted?.taskId).toBe("task_opencode_tool_events")
    expect(toolStarted?.parentAgentId).toBe("orchestrator")
    expect(toolStarted?.groupId).toBe("group_opencode_tool_events")
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

  test("direct Claude Code run uses the external adapter and records a conversation-visible session", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    attachClaudeCodeClient(runManager, new FakeClaudeCodeClient())
    const rootPath = await createWorkspace()

    const run = runManager.createRun({
      conversationId: "conv_claude_code_direct",
      mode: "single",
      participantAgentIds: ["claude-code"],
      addressedAgentIds: ["claude-code"],
      userMessage: {
        role: "user",
        content: "Inspect the workspace.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_claude_code_direct",
        backendType: "local",
        rootPath,
      },
    })

    await waitForTerminalRun(runManager, run.id)

    const completedRun = runManager.getRun(run.id)
    const events = runManager.getEvents(run.id) ?? []
    const started = events.find((event) => event.type === "agent.started" && event.agentId === "claude-code")
    const message = events.find((event) => event.type === "message.completed" && event.agentId === "claude-code")

    expect(completedRun?.status).toBe("completed")
    expect((started?.data as { externalSession?: { scope?: string; providerSessionId?: string } }).externalSession?.scope)
      .toBe("conversation-visible")
    expect((started?.data as { externalSession?: { providerSessionId?: string } }).externalSession?.providerSessionId)
      .toStartWith("fake_claude_code_")
    expect((message?.data as { content?: string }).content).toContain("Claude Code fake adapter received")
    expect((message?.data as {
      externalModel?: { provider?: string; providerId?: string; modelId?: string }
    }).externalModel).toEqual({
      provider: "claude-code",
      providerId: "anthropic",
      modelId: "fake-claude-model",
    })
    expect(message?.messageIndex).toBe(0)
  })

  test("direct Claude Code run reuses a conversation-visible session hint", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    attachClaudeCodeClient(runManager, new FakeClaudeCodeClient())
    const rootPath = await createWorkspace()

    const run = runManager.createRun({
      conversationId: "conv_claude_code_reuse",
      mode: "single",
      participantAgentIds: ["claude-code"],
      addressedAgentIds: ["claude-code"],
      userMessage: {
        role: "user",
        content: "Continue the prior session.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_claude_code_reuse",
        backendType: "local",
        rootPath,
      },
      externalSessionHints: [{
        provider: "claude-code",
        agentId: "claude-code",
        scope: "conversation-visible",
        providerSessionId: "provider_session_existing",
        conversationId: "conv_claude_code_reuse",
        workspaceId: "workspace_claude_code_reuse",
      }],
    })

    await waitForTerminalRun(runManager, run.id)

    const events = runManager.getEvents(run.id) ?? []
    const started = events.find((event) => event.type === "agent.started" && event.agentId === "claude-code")

    expect((started?.data as { externalSession?: { providerSessionId?: string } }).externalSession?.providerSessionId)
      .toBe("provider_session_existing")
  })

  test("direct Claude Code tool events reuse the assistant message identity", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    attachClaudeCodeClient(runManager, new ToolStreamingClaudeCodeClient())
    const rootPath = await createWorkspace()

    const run = runManager.createRun({
      conversationId: "conv_claude_code_tool_events",
      mode: "single",
      participantAgentIds: ["claude-code"],
      addressedAgentIds: ["claude-code"],
      userMessage: {
        role: "user",
        content: "Edit the file.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_claude_code_tool_events",
        backendType: "local",
        rootPath,
      },
    })

    await waitForTerminalRun(runManager, run.id)

    const events = runManager.getEvents(run.id) ?? []
    const message = events.find((event) => event.type === "message.completed" && event.agentId === "claude-code")
    const toolStarted = events.find((event) => event.type === "tool.started" && event.agentId === "claude-code")
    const toolCompleted = events.find((event) => event.type === "tool.completed" && event.agentId === "claude-code")

    expect(toolStarted?.messageId).toBe(message?.messageId)
    expect(toolCompleted?.messageId).toBe(message?.messageId)
    expect(toolStarted?.toolCallId).toBe("claude-code:toolu_edit")
    expect(toolStarted?.toolName).toBe("Edit")
    expect((toolStarted?.data as { externalProvider?: string; providerToolCallId?: string }).externalProvider)
      .toBe("claude-code")
    expect((toolCompleted?.data as { output?: { content?: string } }).output?.content)
      .toBe("Updated src/index.ts")
  })

  test("direct Claude Code permission requests resolve through Runtime decisions", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    attachClaudeCodeClient(runManager, new PermissionStreamingClaudeCodeClient())
    const rootPath = await createWorkspace()

    const run = runManager.createRun({
      conversationId: "conv_claude_code_permission",
      mode: "single",
      participantAgentIds: ["claude-code"],
      addressedAgentIds: ["claude-code"],
      userMessage: {
        role: "user",
        content: "Edit src/index.ts.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_claude_code_permission",
        backendType: "local",
        rootPath,
      },
    })

    const requested = await waitForEvent(runManager, run.id, (event) => event.type === "permission.requested")
    expect(requested.messageId).toBeDefined()
    expect(requested.toolCallId).toBe("claude-code:toolu_edit")
    expect((requested.data as { data?: { providerPermissionId?: string; externalProvider?: string } }).data?.providerPermissionId)
      .toBe("perm_edit")
    expect((requested.data as { data?: { externalProvider?: string } }).data?.externalProvider)
      .toBe("claude-code")

    const decision = runManager.decidePermission(
      run.id,
      (requested.data as { requestId: string }).requestId,
      true,
      "Approved once"
    )
    expect(decision.status).toBe("approved")

    await waitForTerminalRun(runManager, run.id)
    const events = runManager.getEvents(run.id) ?? []
    const message = events.find((event) => event.type === "message.completed" && event.agentId === "claude-code")
    const approved = events.find((event) => event.type === "permission.approved")
    expect(message?.messageId).toBe(requested.messageId)
    expect(approved?.messageId).toBe(requested.messageId)
    expect((message?.data as { content?: string }).content).toContain("Permission approved")
  })

  test("direct Claude Code AskUserQuestion waits for a product question answer", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    attachClaudeCodeClient(runManager, new QuestionAskingClaudeCodeClient())
    const rootPath = await createWorkspace()

    const run = runManager.createRun({
      conversationId: "conv_claude_code_question",
      mode: "single",
      participantAgentIds: ["claude-code"],
      addressedAgentIds: ["claude-code"],
      userMessage: {
        role: "user",
        content: "Ask me before choosing an approach.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_claude_code_question",
        backendType: "local",
        rootPath,
      },
    })

    const requested = await waitForEvent(runManager, run.id, (event) => event.type === "question.requested")
    expect(runManager.getRun(run.id)?.status).toBe("waiting_input")
    expect(requested.toolCallId).toBe("claude-code:ask_user_question")
    expect((requested.data as { externalProvider?: string }).externalProvider).toBe("claude-code")
    const requestId = (requested.data as { requestId?: string }).requestId
    expect(requestId).toBeTruthy()

    const answered = runManager.answerQuestion(run.id, requestId!, [{
      questionId: "approach",
      optionId: "minimal",
    }])
    expect(answered.status).toBe("answered")

    await waitForTerminalRun(runManager, run.id)
    const events = runManager.getEvents(run.id) ?? []
    const message = events.find((event) => event.type === "message.completed" && event.agentId === "claude-code")
    expect((message?.data as { content?: string }).content).toContain("User chose Minimal")
    expect(events.some((event) => event.type === "question.answered")).toBe(true)
    expect(events.some((event) => event.type.startsWith("permission."))).toBe(false)
    expect(events.some((event) =>
      event.type === "tool.completed" &&
      event.toolName === "question" &&
      event.toolCallId === "claude-code:ask_user_question"
    )).toBe(true)
  })

  test("direct Codex run uses the external adapter and records a conversation-visible thread", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    attachCodexClient(runManager, new FakeCodexClient())
    const rootPath = await createWorkspace()

    const run = runManager.createRun({
      conversationId: "conv_codex_direct",
      mode: "single",
      participantAgentIds: ["codex"],
      addressedAgentIds: ["codex"],
      userMessage: {
        role: "user",
        content: "Inspect the workspace.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_codex_direct",
        backendType: "local",
        rootPath,
      },
    })

    await waitForTerminalRun(runManager, run.id)

    const completedRun = runManager.getRun(run.id)
    const events = runManager.getEvents(run.id) ?? []
    const started = events.find((event) => event.type === "agent.started" && event.agentId === "codex")
    const message = events.find((event) => event.type === "message.completed" && event.agentId === "codex")

    expect(completedRun?.status).toBe("completed")
    expect((started?.data as { externalSession?: { scope?: string; providerSessionId?: string } }).externalSession?.scope)
      .toBe("conversation-visible")
    expect((started?.data as { externalSession?: { providerSessionId?: string } }).externalSession?.providerSessionId)
      .toStartWith("fake_codex_")
    expect((message?.data as { content?: string }).content).toContain("Codex fake adapter received")
    expect((message?.data as {
      externalModel?: { provider?: string; providerId?: string; modelId?: string }
    }).externalModel).toEqual({
      provider: "codex",
      providerId: "openai",
      modelId: "fake-codex-model",
    })
    expect(message?.messageIndex).toBe(0)
  })

  test("direct Codex group run prepends AgentHub external context", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    const client = new PromptCapturingCodexClient()
    attachCodexClient(runManager, client)
    const rootPath = await createWorkspace()

    const run = runManager.createRun({
      conversationId: "conv_codex_context",
      mode: "group",
      participantAgentIds: ["orchestrator", "codex"],
      addressedAgentIds: ["codex"],
      userMessage: {
        role: "user",
        content: "Continue from the prior implementation.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_codex_context",
        backendType: "local",
        rootPath,
      },
      externalContext: [{
        provider: "codex",
        agentId: "codex",
        scope: "conversation-visible",
        mode: "delta",
        messages: [{
          id: "msg_visible_user",
          role: "user",
          senderLabel: "user",
          createdAt: "2026-06-06T00:00:00.000Z",
          content: "Earlier visible request.",
        }],
        handoffSummaries: [{
          sessionId: "eas_task_codex",
          providerSessionId: "codex_task_session",
          taskId: "task_codex",
          runId: "run_codex",
          summary: "Codex previously inspected the SDK adapter.",
        }],
        cursorCandidate: {
          throughMessageId: "msg_visible_user",
          throughMessageCreatedAt: "2026-06-06T00:00:00.000Z",
          includedMessageIds: ["msg_visible_user"],
          includedHandoffSessionIds: ["eas_task_codex"],
        },
      }],
    })

    await waitForTerminalRun(runManager, run.id)

    const prompt = client.prompts[0]?.prompt.content ?? ""
    const events = runManager.getEvents(run.id) ?? []
    const completed = events.find((event) => event.type === "agent.completed" && event.agentId === "codex")
    const completedData = completed?.data as {
      externalContext?: Record<string, unknown>
    }

    expect(prompt).toContain("AgentHub visible context (delta).")
    expect(prompt).toContain("Earlier visible request.")
    expect(prompt).toContain("Codex previously inspected the SDK adapter.")
    expect(prompt).toContain("Current user request:")
    expect(prompt).toContain("Continue from the prior implementation.")
    expect(completedData.externalContext).toEqual({
      provider: "codex",
      agentId: "codex",
      scope: "conversation-visible",
      mode: "delta",
      messageCount: 1,
      handoffSummaryCount: 1,
      cursorCandidate: {
        throughMessageId: "msg_visible_user",
        throughMessageCreatedAt: "2026-06-06T00:00:00.000Z",
        includedMessageIds: ["msg_visible_user"],
        includedHandoffSessionIds: ["eas_task_codex"],
      },
      omitted: undefined,
    })
  })

  test("direct Codex run reuses a conversation-visible session hint", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    attachCodexClient(runManager, new FakeCodexClient())
    const rootPath = await createWorkspace()

    const run = runManager.createRun({
      conversationId: "conv_codex_reuse",
      mode: "single",
      participantAgentIds: ["codex"],
      addressedAgentIds: ["codex"],
      userMessage: {
        role: "user",
        content: "Continue the prior Codex thread.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_codex_reuse",
        backendType: "local",
        rootPath,
      },
      externalSessionHints: [{
        provider: "codex",
        agentId: "codex",
        scope: "conversation-visible",
        providerSessionId: "codex_thread_existing",
        conversationId: "conv_codex_reuse",
        workspaceId: "workspace_codex_reuse",
      }],
    })

    await waitForTerminalRun(runManager, run.id)

    const events = runManager.getEvents(run.id) ?? []
    const started = events.find((event) => event.type === "agent.started" && event.agentId === "codex")

    expect((started?.data as { externalSession?: { providerSessionId?: string } }).externalSession?.providerSessionId)
      .toBe("codex_thread_existing")
  })

  test("delegated Codex task keeps task identity and produces a handoff summary", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    attachCodexClient(runManager, new FakeCodexClient())
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
        await context.runTask?.({
          taskId: "task_codex_delegated",
          targetAgentId: "codex",
          title: "Ask Codex",
          instruction: "Use Codex for this delegated task.",
          expectedOutput: "A Codex response",
          requiredCapabilities: ["external-agent"],
          riskLevel: "low",
          dependsOn: [],
        }, {
          groupId: "group_codex_delegated",
        })

        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    const run = runManager.createRun({
      conversationId: "conv_codex_delegated",
      mode: "group",
      participantAgentIds: ["orchestrator", "codex"],
      addressedAgentIds: [],
      userMessage: {
        role: "user",
        content: "Delegate to Codex.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_codex_delegated",
        backendType: "local",
        rootPath,
      },
    })

    await waitForTerminalRun(runManager, run.id)

    const events = runManager.getEvents(run.id) ?? []
    const started = events.find((event) => event.type === "agent.started" && event.agentId === "codex")
    const message = events.find((event) => event.type === "message.completed" && event.agentId === "codex")
    const agentCompleted = events.find((event) => event.type === "agent.completed" && event.agentId === "codex")
    const completedData = agentCompleted?.data as {
      handoffSummary?: string
      externalSession?: { handoffSummary?: string }
    }

    expect((started?.data as { externalSession?: { scope?: string; taskId?: string } }).externalSession?.scope)
      .toBe("delegated-task")
    expect((started?.data as { externalSession?: { taskId?: string } }).externalSession?.taskId)
      .toBe("task_codex_delegated")
    expect(message?.taskId).toBe("task_codex_delegated")
    expect(message?.parentAgentId).toBe("orchestrator")
    expect(message?.groupId).toBe("group_codex_delegated")
    expect((message?.data as { content?: string }).content)
      .toContain("Codex fake adapter completed delegated task")
    expect(completedData.handoffSummary).toContain("Codex completed delegated task \"Ask Codex\".")
    expect(completedData.handoffSummary).not.toContain("Use Codex for this delegated task.")
    expect(completedData.externalSession?.handoffSummary).toBe(completedData.handoffSummary)
  })
})
