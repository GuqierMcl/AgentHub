import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentRegistry } from "../src/agents"
import { buildSystemPrompt } from "../src/runtime/ai-sdk-executor"
import { OrchestratorExecutor } from "../src/runtime/orchestrator-executor"
import {
  createDefaultRuntimeToolRegistry,
  type AgentExecutionContext,
} from "../src/runtime"
import type { ProviderService } from "../src/provider"

async function createInitializedRegistry(): Promise<AgentRegistry> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-pinned-messages-"))
  const registry = new AgentRegistry(dataDir, createDefaultRuntimeToolRegistry())
  await registry.initialize()
  return registry
}

describe("pinned messages", () => {
  test("injects pinned messages into AI SDK and Orchestrator system prompts", async () => {
    const registry = await createInitializedRegistry()
    const coder = registry.getAgent("coder")!
    const orchestrator = registry.getAgent("orchestrator")!
    const input = {
      conversationId: "conv_pinned_messages",
      mode: "group" as const,
      participantAgentIds: ["orchestrator", "coder"],
      addressedAgentIds: [],
      userMessage: {
        role: "user" as const,
        content: "Can you see the pinned message?",
      },
      history: [],
      pinnedMessages: [
        {
          id: "mp_1",
          messageId: "msg_pinned",
          content: "Pinned context: deployment target is staging.",
          note: null,
          pinnedAt: "2026-06-04T08:00:00.000Z",
          sortOrder: 0,
        },
      ],
    }
    const context = {
      runId: "run_pinned_messages",
      input,
      agent: coder,
      signal: new AbortController().signal,
    } satisfies AgentExecutionContext

    expect(buildSystemPrompt(context)).toContain("Pinned context: deployment target is staging.")

    const executor = new OrchestratorExecutor(
      registry,
      {} as ProviderService,
      createDefaultRuntimeToolRegistry()
    )

    expect(executor.buildSystemPrompt({
      ...context,
      agent: orchestrator,
    })).toContain("Pinned context: deployment target is staging.")
  })
})
