import { describe, expect, test } from "bun:test"
import type { TextStreamPart, ToolSet } from "ai"
import {
  MessageBlockEventBuilder,
  MessageBlockIdentityTracker,
  ModelStreamEventBuilder,
  RunManager,
  createDefaultRuntimeToolRegistry,
  createRunEvent,
  type AgentExecutionContext,
  type RunEvent,
  type RunInput,
} from "../src/runtime"
import { AgentRegistry, type AgentDefinition } from "../src/agents"
import type { ProviderService } from "../src/provider"
import type { RuntimeGeneration } from "../src/runtime/generation"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const agent: AgentDefinition = {
  id: "coder",
  name: "Coder",
  description: "Test coding agent",
  tier: "primary",
  origin: "system",
  visibility: "visible",
  entryPolicy: "callable",
  delegationPolicy: "terminal",
  executorType: "ai-sdk",
  capabilities: ["implementation"],
  allowedSubagents: [],
  allowedTools: [],
  allowedSkills: [],
  permissionPolicy: {
    filesystem: "none",
    shell: "none",
    network: "none",
    deploy: "none",
  },
  enabled: true,
  readonly: true,
}

const baseInput: RunInput = {
  conversationId: "conv_message_identity",
  mode: "single",
  participantAgentIds: ["coder"],
  addressedAgentIds: [],
  userMessage: {
    role: "user",
    content: "Write in two text blocks.",
  },
  history: [],
}

function part(value: Record<string, unknown>): TextStreamPart<ToolSet> {
  return value as unknown as TextStreamPart<ToolSet>
}

function createContext(): AgentExecutionContext {
  let messageIndex = 0
  return {
    runId: "run_message_identity",
    input: baseInput,
    agent,
    signal: new AbortController().signal,
    executionId: "execution_test",
    createMessageId: () => `msg_run_message_identity_execution_test_${messageIndex++}`,
  }
}

function eventData(event: RunEvent): Record<string, unknown> {
  return event.data as Record<string, unknown>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createInitializedRegistry(): Promise<AgentRegistry> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-message-identity-"))
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

describe("message stream event helpers", () => {
  test("splits AI SDK text blocks into distinct runtime message ids", () => {
    const builder = new MessageBlockEventBuilder(createContext())
    const events = [
      ...builder.createEvents(part({ type: "text-start", id: "text_1" })),
      ...builder.createEvents(part({ type: "text-delta", id: "text_1", text: "First" })),
      ...builder.createEvents(part({ type: "text-end", id: "text_1" })),
      ...builder.createEvents(part({ type: "text-start", id: "text_2" })),
      ...builder.createEvents(part({ type: "text-delta", id: "text_2", text: "Second" })),
      ...builder.createEvents(part({ type: "text-end", id: "text_2" })),
    ]

    expect(events.map((event) => event.type)).toEqual([
      "message.delta",
      "message.completed",
      "message.delta",
      "message.completed",
    ])
    expect(events.map((event) => event.messageId)).toEqual([
      "msg_run_message_identity_execution_test_0",
      "msg_run_message_identity_execution_test_0",
      "msg_run_message_identity_execution_test_1",
      "msg_run_message_identity_execution_test_1",
    ])
    expect(eventData(events[1]!).content).toBe("First")
    expect(eventData(events[3]!).content).toBe("Second")
  })

  test("fallback text deltas without start/end still complete one block", () => {
    const builder = new MessageBlockEventBuilder(createContext())
    const deltas = [
      ...builder.createEvents(part({ type: "text-delta", id: "legacy_text", text: "Hello " })),
      ...builder.createEvents(part({ type: "text-delta", id: "legacy_text", text: "world" })),
    ]
    const completed = builder.flushOpenBlocks()

    expect(deltas.map((event) => event.messageId)).toEqual([
      "msg_run_message_identity_execution_test_0",
      "msg_run_message_identity_execution_test_0",
    ])
    expect(completed).toHaveLength(1)
    expect(completed[0]?.messageId).toBe("msg_run_message_identity_execution_test_0")
    expect(eventData(completed[0]!).content).toBe("Hello world")
    expect(eventData(completed[0]!).generation).toBeUndefined()
  })

  test("adds base generation metadata to message events", () => {
    const generation: RuntimeGeneration = {
      executionId: "execution_test",
      model: {
        providerId: "openai",
        modelId: "gpt-5.1",
        providerName: "OpenAI",
        modelName: "GPT-5.1",
        modelSourceAgentId: "coder",
      },
    }
    const builder = new MessageBlockEventBuilder(createContext(), undefined, generation)
    const events = [
      ...builder.createEvents(part({ type: "text-start", id: "text_generation" })),
      ...builder.createEvents(part({
        type: "text-delta",
        id: "text_generation",
        text: "Hello",
      })),
      ...builder.createEvents(part({ type: "text-end", id: "text_generation" })),
    ]

    expect(events.map((event) => event.type)).toEqual([
      "message.delta",
      "message.completed",
    ])
    expect(eventData(events[0]!).generation).toEqual(generation)
    expect(eventData(events[1]!).generation).toEqual(generation)
  })

  test("reasoning and following text share the same runtime message id", () => {
    const context = createContext()
    const identity = new MessageBlockIdentityTracker(context)
    const modelStreamEvents = new ModelStreamEventBuilder(context, identity)
    const messageBlockEvents = new MessageBlockEventBuilder(context, identity)

    const reasoningEvents = [
      ...modelStreamEvents.createEvents(part({ type: "reasoning-start", id: "reasoning_1" })),
      ...modelStreamEvents.createEvents(part({
        type: "reasoning-delta",
        id: "reasoning_1",
        text: "Think first.",
      })),
      ...modelStreamEvents.createEvents(part({ type: "reasoning-end", id: "reasoning_1" })),
    ].filter((event) => event.type.startsWith("reasoning."))

    const messageEvents = [
      ...messageBlockEvents.createEvents(part({ type: "text-start", id: "text_1" })),
      ...messageBlockEvents.createEvents(part({ type: "text-delta", id: "text_1", text: "Answer." })),
      ...messageBlockEvents.createEvents(part({ type: "text-end", id: "text_1" })),
    ]

    expect(reasoningEvents.map((event) => event.messageId)).toEqual([
      "msg_run_message_identity_execution_test_0",
      "msg_run_message_identity_execution_test_0",
      "msg_run_message_identity_execution_test_0",
    ])
    expect(messageEvents.map((event) => event.messageId)).toEqual([
      "msg_run_message_identity_execution_test_0",
      "msg_run_message_identity_execution_test_0",
    ])
  })

  test("RunManager assigns messageIndex by first emitted message id", async () => {
    const registry = await createInitializedRegistry()
    const providerService = {} as ProviderService
    const runManager = new RunManager(registry, providerService)

    ;(runManager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: { runId: string; agent: { id: string } }): AsyncIterable<RunEvent> {
        const firstReasoning = createRunEvent(context.runId, "reasoning.delta", context.agent.id, {
          reasoningId: "reasoning_first",
          delta: "Thinking",
        })
        firstReasoning.messageId = "msg_first"
        yield firstReasoning

        const firstDelta = createRunEvent(context.runId, "message.delta", context.agent.id, { delta: "First" })
        firstDelta.messageId = "msg_first"
        yield firstDelta
        const firstCompleted = createRunEvent(context.runId, "message.completed", context.agent.id, { content: "First" })
        firstCompleted.messageId = "msg_first"
        yield firstCompleted

        const secondDelta = createRunEvent(context.runId, "message.delta", context.agent.id, { delta: "Second" })
        secondDelta.messageId = "msg_second"
        yield secondDelta
        const secondCompleted = createRunEvent(context.runId, "message.completed", context.agent.id, { content: "Second" })
        secondCompleted.messageId = "msg_second"
        yield secondCompleted

        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    const run = runManager.createRun(baseInput)
    await waitForTerminalRun(runManager, run.id)

    const messageEvents = (runManager.getEvents(run.id) ?? [])
      .filter((event) =>
        event.type === "reasoning.delta" ||
        event.type === "message.delta" ||
        event.type === "message.completed"
      )

    expect(messageEvents.map((event) => event.messageIndex)).toEqual([0, 0, 0, 1, 1])
  })
})
