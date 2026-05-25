import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentRegistry } from "../src/agents"
import {
  RunManager,
  RunWorkspaceValidationError,
  createDefaultRuntimeToolRegistry,
  createRunEvent,
  type AgentExecutionContext,
  type RunEvent,
} from "../src/runtime"
import runsRouter from "../src/routers/runs"
import type { ProviderService } from "../src/provider"

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForTerminal(manager: RunManager, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = manager.getRun(runId)
    if (run && ["completed", "failed", "cancelled"].includes(run.status)) {
      return
    }
    await sleep(5)
  }
  throw new Error("Run did not terminate")
}

async function createManager(): Promise<{
  manager: RunManager
  registry: AgentRegistry
  tools: ReturnType<typeof createDefaultRuntimeToolRegistry>
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-session-data-"))
  const tools = createDefaultRuntimeToolRegistry()
  const registry = new AgentRegistry(dataDir, tools)
  await registry.initialize()
  const manager = new RunManager(registry, {} as ProviderService, undefined, tools)
  return { manager, registry, tools }
}

function createRunsApp(registry: AgentRegistry, manager: RunManager): Hono {
  const app = new Hono()
  app.use("*", async (c: Context, next: Next) => {
    c.set("agentRegistry", registry)
    c.set("runManager", manager)
    await next()
  })
  app.route("/", runsRouter)
  return app
}

async function createWorkspace(content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-runtime-session-workspace-"))
  await mkdir(join(root, "src"), { recursive: true })
  await writeFile(join(root, "src", "note.txt"), content, "utf-8")
  return root
}

function runInput(rootPath?: string) {
  return {
    conversationId: "conv_workspace",
    mode: "single" as const,
    participantAgentIds: ["coder"],
    addressedAgentIds: ["coder"],
    userMessage: { role: "user" as const, content: "Read src/note.txt" },
    history: [],
    ...(rootPath ? {
      workspace: {
        workspaceId: "workspace_current",
        backendType: "local" as const,
        rootPath,
      },
    } : {}),
  }
}

describe("Run workspace sessions", () => {
  test("binds file access per run and exposes only a safe workspace summary", async () => {
    const firstRoot = await createWorkspace("first workspace")
    const secondRoot = await createWorkspace("second workspace")
    const { manager, tools } = await createManager()
    const contents: string[] = []

    ;(manager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        const result = await tools.executeTool("read_file", { path: "src/note.txt" }, context, {
          toolCallId: `tool_${context.runId}`,
        })
        const block = (result.data as { blocks?: Array<{ text?: string }> } | undefined)?.blocks?.[0]
        contents.push(block?.text ?? result.error?.code ?? "")
        yield createRunEvent(context.runId, "message.completed", context.agent.id, { content: "done" })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, { status: "completed" })
      },
    }

    const first = manager.createRun(runInput(firstRoot))
    const second = manager.createRun(runInput(secondRoot))
    await Promise.all([waitForTerminal(manager, first.id), waitForTerminal(manager, second.id)])

    expect(contents).toEqual(expect.arrayContaining(["first workspace", "second workspace"]))
    const response = manager.getRunResponse(first.id)!
    expect(response.input.workspace?.rootLabel).toBe(firstRoot.split(/[\\/]/).at(-1))
    expect(JSON.stringify(response)).not.toContain(firstRoot)
    expect(JSON.stringify(manager.getEvents(first.id))).not.toContain(firstRoot)
  })

  test("does not fall back to a global workspace and rejects invalid snapshots", async () => {
    const { manager, tools } = await createManager()
    let resultCode = ""
    ;(manager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        const result = await tools.executeTool("read_file", { path: "src/note.txt" }, context)
        resultCode = result.error?.code ?? ""
        yield createRunEvent(context.runId, "message.completed", context.agent.id, { content: "done" })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, { status: "completed" })
      },
    }

    const withoutWorkspace = manager.createRun(runInput())
    await waitForTerminal(manager, withoutWorkspace.id)
    expect(resultCode).toBe("WORKSPACE_NOT_BOUND")
    expect(() => manager.createRun(runInput(join(tmpdir(), "not-a-real-runtime-workspace"))))
      .toThrow(RunWorkspaceValidationError)
  })

  test("runs API rejects invalid workspace snapshots and redacts workspace roots in responses", async () => {
    const root = await createWorkspace("api workspace")
    const missingRoot = join(tmpdir(), "not-a-real-runtime-workspace-api")
    const { manager, registry, tools } = await createManager()
    const app = createRunsApp(registry, manager)

    ;(manager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        await tools.executeTool("read_file", { path: "src/note.txt" }, context, {
          toolCallId: `tool_${context.runId}`,
        })
        yield createRunEvent(context.runId, "message.completed", context.agent.id, { content: "done" })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, { status: "completed" })
      },
    }

    const invalid = await app.request("/runtime/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runInput(missingRoot)),
    })
    const invalidBody = await invalid.json() as { error: { code: string } }
    expect(invalid.status).toBe(400)
    expect(invalidBody.error.code).toBe("RUN_INVALID_WORKSPACE")
    expect(JSON.stringify(invalidBody)).not.toContain(missingRoot)

    const created = await app.request("/runtime/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runInput(root)),
    })
    expect(created.status).toBe(201)
    const { runId } = await created.json() as { runId: string }
    await waitForTerminal(manager, runId)

    const status = await app.request(`/runtime/runs/${runId}`)
    const statusBody = await status.json()
    expect(status.status).toBe(200)
    expect(JSON.stringify(statusBody)).not.toContain(root)
    expect((statusBody as { input: { workspace?: { rootLabel?: string; rootPath?: string } } }).input.workspace?.rootLabel)
      .toBe(root.split(/[\\/]/).at(-1))
    expect((statusBody as { input: { workspace?: { rootPath?: string } } }).input.workspace?.rootPath).toBeUndefined()
  })
})
