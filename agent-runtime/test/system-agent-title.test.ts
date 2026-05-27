import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentRegistry } from "../src/agents"
import {
  RunManager,
  SystemAgentRunner,
  createDefaultRuntimeToolRegistry,
  createRunEvent,
  type RunEvent,
  type SystemAgentCompletedData,
} from "../src/runtime"
import type { ProviderService } from "../src/provider"
import type { RunInput } from "../src/runtime"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

async function createInitializedRegistry(): Promise<AgentRegistry> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-system-agent-"))
  const registry = new AgentRegistry(dataDir, createDefaultRuntimeToolRegistry())
  await registry.initialize()
  return registry
}

function createTitleResult(conversationId: string, inheritedModelFromAgentId: string): SystemAgentCompletedData {
  return {
    systemAgentId: "title",
    conversationId,
    target: "conversation.title",
    trigger: "first_user_message",
    inheritedModelFromAgentId,
    result: {
      title: "系统智能体层级设计",
    },
  }
}

function installCompletedEntryExecutor(runManager: RunManager): void {
  ;(runManager as any).aiSdkExecutor = {
    executorType: "ai-sdk",
    async *execute(context: {
      runId: string
      agent: { id: string }
    }): AsyncIterable<RunEvent> {
      yield createRunEvent(context.runId, "message.completed", context.agent.id, {
        content: "done",
      })
      yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
        status: "completed",
      })
    },
  }
}

describe("title system agent", () => {
  test("emits title result before run.completed when the result is ready", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    installCompletedEntryExecutor(runManager)

    ;(runManager as any).systemAgentRunner = {
      shouldRunTitle: (input: RunInput) => input.history.length === 0,
      runTitle: async (options: { input: RunInput; entryAgent: { id: string } }) =>
        createTitleResult(options.input.conversationId, options.entryAgent.id),
    }

    const run = runManager.createRun({
      conversationId: "conv_title_ready",
      mode: "single",
      participantAgentIds: ["coder"],
      userMessage: {
        role: "user",
        content: "我想讨论系统智能体层级设计。",
      },
      history: [],
    })

    await waitForTerminalRun(runManager, run.id)

    const events = runManager.getEvents(run.id) ?? []
    const systemAgentIndex = events.findIndex((event) => event.type === "system_agent.completed")
    const runCompletedIndex = events.findIndex((event) => event.type === "run.completed")

    expect(systemAgentIndex).toBeGreaterThan(-1)
    expect(runCompletedIndex).toBeGreaterThan(-1)
    expect(systemAgentIndex).toBeLessThan(runCompletedIndex)
    expect(events[systemAgentIndex].agentId).toBe("system:title")
    expect(events[systemAgentIndex].data).toEqual(createTitleResult("conv_title_ready", "coder"))
  })

  test("skips and cancels title work when the title result is not ready before run.completed", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    installCompletedEntryExecutor(runManager)
    let abortObserved = false

    ;(runManager as any).systemAgentRunner = {
      shouldRunTitle: () => true,
      runTitle: ({ signal }: { signal: AbortSignal }) =>
        new Promise<SystemAgentCompletedData | null>((resolve) => {
          if (signal.aborted) {
            abortObserved = true
            resolve(null)
            return
          }

          signal.addEventListener("abort", () => {
            abortObserved = true
            resolve(null)
          }, { once: true })
        }),
    }

    const run = runManager.createRun({
      conversationId: "conv_title_late",
      mode: "single",
      participantAgentIds: ["coder"],
      userMessage: {
        role: "user",
        content: "请帮我写一个标题。",
      },
      history: [],
    })

    await waitForTerminalRun(runManager, run.id)

    const events = runManager.getEvents(run.id) ?? []
    expect(events.some((event) => event.type === "system_agent.completed")).toBe(false)
    expect(events.at(-1)?.type).toBe("run.completed")
    expect(abortObserved).toBe(true)
  })

  test("does not trigger title after the first conversation turn", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    installCompletedEntryExecutor(runManager)
    let titleStarted = false

    ;(runManager as any).systemAgentRunner = {
      shouldRunTitle: (input: RunInput) => input.history.length === 0,
      runTitle: async (options: { input: RunInput; entryAgent: { id: string } }) => {
        titleStarted = true
        return createTitleResult(options.input.conversationId, options.entryAgent.id)
      },
    }

    const run = runManager.createRun({
      conversationId: "conv_title_second_turn",
      mode: "single",
      participantAgentIds: ["coder"],
      userMessage: {
        role: "user",
        content: "继续聊一下。",
      },
      history: [
        {
          role: "user",
          content: "第一轮消息。",
        },
      ],
    })

    await waitForTerminalRun(runManager, run.id)

    const events = runManager.getEvents(run.id) ?? []
    expect(titleStarted).toBe(false)
    expect(events.some((event) => event.type === "system_agent.completed")).toBe(false)
  })

  test("uses conversationState as the first-turn title trigger source", () => {
    const runner = new SystemAgentRunner({} as ProviderService)
    const input: RunInput = {
      conversationId: "conv_title_trigger",
      mode: "single",
      participantAgentIds: ["coder"],
      userMessage: {
        role: "user",
        content: "帮我设计系统智能体。",
      },
      history: [],
    }

    expect(runner.shouldRunTitle({
      ...input,
      conversationState: { messageCountBeforeRun: 0, titleSource: "default" },
    })).toBe(true)
    expect(runner.shouldRunTitle({
      ...input,
      conversationState: { messageCountBeforeRun: 1, titleSource: "default" },
    })).toBe(false)
    expect(runner.shouldRunTitle({
      ...input,
      conversationState: { messageCountBeforeRun: 0, titleSource: "manual" },
    })).toBe(false)
    expect(runner.shouldRunTitle({
      ...input,
      history: [{ role: "user", content: "第一轮" }],
    })).toBe(false)
  })
})
