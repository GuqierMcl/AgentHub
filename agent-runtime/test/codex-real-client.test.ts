import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import {
  ExternalAdapterError,
  RealCodexClient,
  getCodexReadiness,
  type CodexPromptEvent,
} from "../src/runtime"

class FakeCodexThread {
  runCalls: unknown[][] = []

  constructor(
    readonly id: string,
    private readonly response: unknown = {
      finalResponse: "Codex SDK final response",
      model: "gpt-5.1-codex",
    }
  ) {}

  async run(...args: unknown[]) {
    this.runCalls.push(args)
    return this.response
  }
}

class FakeStreamedCodexThread {
  runCalls: unknown[][] = []
  runStreamedCalls: unknown[][] = []

  constructor(
    readonly id: string | null,
    private readonly events: unknown[]
  ) {}

  async run(...args: unknown[]) {
    this.runCalls.push(args)
    throw new Error("streamed test should not call run")
  }

  async runStreamed(...args: unknown[]) {
    this.runStreamedCalls.push(args)
    return {
      events: this.iterEvents(),
    }
  }

  private async *iterEvents() {
    for (const event of this.events) {
      yield event
    }
  }
}

class FakeCodexSdk {
  startedThreads: FakeCodexThread[] = []
  resumedThreadIds: string[] = []

  async startThread() {
    const thread = new FakeCodexThread(`thread_started_${this.startedThreads.length + 1}`)
    this.startedThreads.push(thread)
    return thread
  }

  async resumeThread(threadId: string) {
    this.resumedThreadIds.push(threadId)
    return new FakeCodexThread(threadId, {
      outputText: "Codex resumed thread response",
      model: "gpt-5.1-codex",
    })
  }
}

async function collectEvents(iterable: AsyncIterable<CodexPromptEvent>): Promise<CodexPromptEvent[]> {
  const events: CodexPromptEvent[] = []
  for await (const event of iterable) {
    events.push(event)
  }
  return events
}

describe("RealCodexClient", () => {
  test("starts a new SDK thread and maps the final response to message events", async () => {
    const sdk = new FakeCodexSdk()
    const client = new RealCodexClient({
      createSdk: () => sdk,
    })

    const session = await client.ensureSession({
      runId: "run_codex_sdk_start",
      conversationId: "conv_codex_sdk_start",
      agentId: "codex",
      scope: "conversation-visible",
      workspaceId: "workspace_codex_sdk_start",
      workspaceRootPath: tmpdir(),
    })

    const events = await collectEvents(client.streamPrompt({
      session,
      prompt: {
        scope: "conversation-visible",
        content: "Explain the repo.",
      },
      cwd: tmpdir(),
      signal: new AbortController().signal,
    }))

    expect(session.providerSessionId).toBe("thread_started_1")
    expect(sdk.startedThreads).toHaveLength(1)
    expect(sdk.startedThreads[0]?.runCalls[0]?.[0]).toBe("Explain the repo.")
    expect(events).toEqual([
      { type: "message.delta", delta: "Codex SDK final response" },
      {
        type: "message.completed",
        content: "Codex SDK final response",
        externalModel: {
          provider: "codex",
          providerId: "openai",
          modelId: "gpt-5.1-codex",
        },
      },
    ])
  })

  test("resumes a hinted SDK thread before dispatching the prompt", async () => {
    const sdk = new FakeCodexSdk()
    const client = new RealCodexClient({
      createSdk: () => sdk,
    })

    const session = await client.ensureSession({
      runId: "run_codex_sdk_resume",
      conversationId: "conv_codex_sdk_resume",
      agentId: "codex",
      scope: "conversation-visible",
      workspaceId: "workspace_codex_sdk_resume",
      workspaceRootPath: tmpdir(),
      providerSessionId: "thread_existing",
    })

    const events = await collectEvents(client.streamPrompt({
      session,
      prompt: {
        scope: "conversation-visible",
        content: "Continue.",
      },
      cwd: tmpdir(),
      signal: new AbortController().signal,
    }))

    expect(session.providerSessionId).toBe("thread_existing")
    expect(sdk.resumedThreadIds).toEqual(["thread_existing"])
    expect(events.find((event) => event.type === "message.completed")).toMatchObject({
      content: "Codex resumed thread response",
    })
  })

  test("maps streamed SDK events without re-running the prompt", async () => {
    const thread = new FakeStreamedCodexThread(null, [
      { type: "thread.started", thread_id: "thread_streamed_1" },
      {
        type: "item.started",
        item: {
          id: "cmd_1",
          type: "command_execution",
          command: "pwd",
          aggregated_output: "",
          status: "in_progress",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "cmd_1",
          type: "command_execution",
          command: "pwd",
          aggregated_output: "D:/PyWorkSpace/AgentHub",
          exit_code: 0,
          status: "completed",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "reason_1",
          type: "reasoning",
          text: "Checked the workspace.",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "msg_1",
          type: "agent_message",
          text: "Streamed Codex response.",
        },
      },
      { type: "turn.completed", usage: null },
    ])
    const client = new RealCodexClient({
      createSdk: () => ({
        startThread: () => thread,
        resumeThread: () => thread,
      }),
    })

    const session = await client.ensureSession({
      runId: "run_codex_sdk_streamed",
      conversationId: "conv_codex_sdk_streamed",
      agentId: "codex",
      scope: "conversation-visible",
      workspaceId: "workspace_codex_sdk_streamed",
      workspaceRootPath: tmpdir(),
    })

    const events = await collectEvents(client.streamPrompt({
      session,
      prompt: {
        scope: "conversation-visible",
        content: "Stream please.",
      },
      cwd: tmpdir(),
      signal: new AbortController().signal,
    }))

    expect(session.providerSessionId).toBe("pending_run_codex_sdk_streamed")
    expect(thread.runStreamedCalls[0]?.[0]).toBe("Stream please.")
    expect(thread.runCalls).toHaveLength(0)
    expect(events).toEqual([
      { type: "session.updated", providerSessionId: "thread_streamed_1" },
      {
        type: "tool.started",
        providerToolCallId: "cmd_1",
        providerToolName: "command_execution",
        input: {
          command: "pwd",
        },
        providerExecuted: false,
        providerMetadata: {
          providerItemType: "command_execution",
        },
      },
      {
        type: "tool.completed",
        providerToolCallId: "cmd_1",
        providerToolName: "command_execution",
        input: {
          command: "pwd",
        },
        output: {
          status: "completed",
          exitCode: 0,
          output: "D:/PyWorkSpace/AgentHub",
        },
        providerExecuted: true,
        providerMetadata: {
          providerItemType: "command_execution",
        },
      },
      {
        type: "reasoning.completed",
        reasoningId: "reason_1",
        content: "Checked the workspace.",
      },
      { type: "message.delta", delta: "Streamed Codex response." },
      { type: "message.completed", content: "Streamed Codex response." },
    ])
  })

  test("maps SDK prompt failures to ADAPTER_PROMPT_FAILED", async () => {
    const client = new RealCodexClient({
      createSdk: () => ({
        async startThread() {
          return {
            id: "thread_failure",
            async run() {
              throw new Error("sdk run failed")
            },
          }
        },
        async resumeThread() {
          throw new Error("failure test should not resume a thread")
        },
      }),
    })
    const session = await client.ensureSession({
      runId: "run_codex_sdk_failure",
      conversationId: "conv_codex_sdk_failure",
      agentId: "codex",
      scope: "conversation-visible",
      workspaceId: "workspace_codex_sdk_failure",
      workspaceRootPath: tmpdir(),
    })

    try {
      await collectEvents(client.streamPrompt({
        session,
        prompt: {
          scope: "conversation-visible",
          content: "Fail.",
        },
        cwd: tmpdir(),
        signal: new AbortController().signal,
      }))
      throw new Error("expected Codex SDK prompt to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(ExternalAdapterError)
      expect((error as ExternalAdapterError).code).toBe("ADAPTER_PROMPT_FAILED")
    }
  })
})

describe("Codex readiness", () => {
  test("reports SDK client mode without starting a thread", () => {
    const readiness = getCodexReadiness({
      createSdk: () => ({
        startThread() {
          throw new Error("readiness should not start a thread")
        },
        resumeThread() {
          throw new Error("readiness should not resume a thread")
        },
      })
    })

    expect(readiness).toMatchObject({
      available: true,
      clientMode: "sdk",
    })
  })
})
