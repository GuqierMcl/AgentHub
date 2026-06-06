import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentRegistry } from "../src/agents"
import { servicesRouter } from "../src/routers/services"
import {
  ClaudeCodeAdapter,
  ExternalAdapterExecutor,
  FakeClaudeCodeClient,
  ManagedOpenCodeServer,
  RunManager,
  createRuntimeServicesStatus,
  createDefaultRuntimeToolRegistry,
  type ClaudeCodePromptRequest,
  type RunEvent,
} from "../src/runtime"
import type { ProviderService } from "../src/provider"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createInitializedRegistry(): Promise<AgentRegistry> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-service-status-"))
  const registry = new AgentRegistry(dataDir, createDefaultRuntimeToolRegistry())
  await registry.initialize()
  return registry
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

function attachClaudeCodeClient(runManager: RunManager, client: FakeClaudeCodeClient): void {
  ;(runManager as any).externalAdapterExecutor = new ExternalAdapterExecutor({
    registry: {
      getAdapter(provider: string) {
        return provider === "claude-code" ? new ClaudeCodeAdapter(client) : null
      },
    },
  })
}

class WaitingClaudeCodeClient extends FakeClaudeCodeClient {
  async *streamPrompt(request: ClaudeCodePromptRequest) {
    yield {
      type: "message.delta" as const,
      delta: "Claude Code is still working.",
    }

    await new Promise<void>((resolve) => {
      if (request.signal.aborted) {
        resolve()
        return
      }

      request.signal.addEventListener("abort", () => resolve(), { once: true })
    })
  }
}

describe("runtime service status", () => {
  test("returns lazy external agent statuses", async () => {
    const app = new Hono()
    app.route("/", servicesRouter)

    const response = await app.request("/runtime/services/status")
    const body = await response.json() as {
      services: Array<{
        id: string
        label: string
        status: string
        implemented: boolean
        activeWorkspaceCount?: number
        pendingWorkspaceCount?: number
      }>
    }

    expect(response.status).toBe(200)
    expect(body.services).toContainEqual(expect.objectContaining({
      id: "opencode",
      label: "OpenCode",
      status: "idle",
      implemented: true,
      activeWorkspaceCount: 0,
      pendingWorkspaceCount: 0,
    }))
    expect(body.services).toContainEqual(expect.objectContaining({
      id: "codex",
      label: "Codex",
      status: "not_integrated",
      implemented: false,
    }))
    expect(body.services).toContainEqual(expect.objectContaining({
      id: "claude-code",
      label: "Claude Code",
      status: "idle",
      implemented: true,
    }))
  })

  test("summarizes OpenCode managed server lifecycle without exposing workspace paths", async () => {
    const server = new ManagedOpenCodeServer({
      resolveSdkWorkspaceOption: () => "cwd",
      allocatePort: async () => 4567,
      createSdkManaged: () => new Promise<never>(() => {}),
    })

    const ensurePromise = server.ensure("D:\\AgentHub\\Workspace")
    await new Promise((resolve) => setTimeout(resolve, 0))

    const starting = server.getStatus()
    expect(starting.status).toBe("starting")
    expect(starting.pendingWorkspaceCount).toBe(1)
    expect(JSON.stringify(starting)).not.toContain("D:\\AgentHub\\Workspace")

    const serviceStatus = createRuntimeServicesStatus(server)
    expect(serviceStatus.services.find((service) => service.id === "opencode")).toMatchObject({
      status: "starting",
      pendingWorkspaceCount: 1,
    })

    await server.closeAll()
    void ensurePromise.catch(() => {})
  })

  test("reports Claude Code as running when the runtime has an active Claude Code run", async () => {
    const server = {
      getStatus: () => ({
        status: "idle" as const,
        mode: "managed-by-runtime" as const,
        activeWorkspaceCount: 0,
        pendingWorkspaceCount: 0,
      }),
    }

    const status = createRuntimeServicesStatus(server, {
      externalAgents: {
        "claude-code": {
          activeRunCount: 1,
        },
      },
    })

    expect(status.services.find((service) => service.id === "claude-code")).toMatchObject({
      status: "running",
      details: expect.objectContaining({
        activeRunCount: 1,
      }),
    })
  })

  test("services router forwards active Claude Code run summaries from RunManager", async () => {
    const app = new Hono()
    app.use("*", async (c: Context, next: Next) => {
      c.set("runManager", {
        getExternalAgentRunSummary(agentId: string) {
          return {
            activeRunCount: agentId === "claude-code" ? 1 : 0,
          }
        },
      })
      await next()
    })
    app.route("/", servicesRouter)

    const response = await app.request("/runtime/services/status")
    const body = await response.json() as {
      services: Array<{
        id: string
        status: string
        details?: Record<string, unknown>
      }>
    }

    expect(body.services.find((service) => service.id === "claude-code")).toMatchObject({
      status: "running",
      details: expect.objectContaining({
        activeRunCount: 1,
      }),
    })
  })

  test("RunManager summarizes non-terminal direct Claude Code runs", async () => {
    const registry = await createInitializedRegistry()
    const runManager = new RunManager(registry, {} as ProviderService)
    attachClaudeCodeClient(runManager, new WaitingClaudeCodeClient())
    const rootPath = await mkdtemp(join(tmpdir(), "agent-runtime-service-status-workspace-"))

    const run = runManager.createRun({
      conversationId: "conv_service_status_claude_code",
      mode: "single",
      participantAgentIds: ["claude-code"],
      addressedAgentIds: ["claude-code"],
      userMessage: {
        role: "user",
        content: "Keep working until cancelled.",
      },
      history: [],
      workspace: {
        workspaceId: "workspace_service_status_claude_code",
        backendType: "local",
        rootPath,
      },
    })

    await waitForEvent(runManager, run.id, (event) =>
      event.type === "message.delta" && event.agentId === "claude-code"
    )

    expect(runManager.getExternalAgentRunSummary("claude-code")).toEqual({
      activeRunCount: 1,
    })

    await runManager.cancelRun(run.id)
    await waitForTerminalRun(runManager, run.id)

    expect(runManager.getExternalAgentRunSummary("claude-code")).toEqual({
      activeRunCount: 0,
    })
  })
})
