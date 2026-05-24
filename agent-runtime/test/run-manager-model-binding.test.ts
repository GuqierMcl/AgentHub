import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentRegistry } from "../src/agents"
import { RunManager, type RunEvent } from "../src/runtime"
import type { ProviderService } from "../src/provider"

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

async function createRegistry(): Promise<AgentRegistry> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-model-binding-"))
  return new AgentRegistry(dataDir)
}

describe("RunManager orchestrator model binding", () => {
  test("orchestrator run fails with a structured error when no model binding exists", async () => {
    const registry = await createRegistry()
    const providerService = {} as ProviderService
    const runManager = new RunManager(registry, providerService)

    const run = runManager.createRun({
      conversationId: "conv_model_binding_missing",
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

    const finalRun = runManager.getRun(run.id)
    const events = runManager.getEvents(run.id) ?? []

    expect(finalRun?.status).toBe("failed")
    expect(finalRun?.error?.code).toBe("MODEL_BINDING_MISSING")
    expect(events.map((event: RunEvent) => event.type)).toEqual([
      "run.started",
      "agent.entry.resolved",
      "run.failed",
    ])
    expect(events.some((event) => event.type === "tool.started")).toBe(false)
    expect(events.some((event) => event.type === "agent.started")).toBe(false)
  })
})
