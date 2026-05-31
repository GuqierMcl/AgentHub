import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ModelMessage } from "ai"
import { AgentRegistry } from "../src/agents"
import {
  createDefaultRuntimeToolRegistry,
  createRunEvent,
  RunManager,
  type AgentExecutionContext,
  type RunEvent,
} from "../src/runtime"
import runsRouter from "../src/routers/runs"
import type { ProviderService } from "../src/provider"

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createHarness(): Promise<{ app: Hono; manager: RunManager; registry: AgentRegistry }> {
  const dataDir = await mkdtemp(join(tmpdir(), "agent-runtime-question-"))
  const tools = createDefaultRuntimeToolRegistry()
  const registry = new AgentRegistry(dataDir, tools)
  await registry.initialize()
  const manager = new RunManager(registry, {} as ProviderService, undefined, tools)

  const app = new Hono()
  app.use("*", async (c: Context, next: Next) => {
    c.set("agentRegistry", registry)
    c.set("runManager", manager)
    await next()
  })
  app.route("/", runsRouter)
  return { app, manager, registry }
}

async function startSingleCoderRun(app: Hono): Promise<string> {
  const response = await app.request("/runtime/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      conversationId: "conv_question",
      mode: "single",
      participantAgentIds: ["coder"],
      addressedAgentIds: ["coder"],
      userMessage: { role: "user", content: "Ask me what you need." },
      history: [],
    }),
  })
  expect(response.status).toBe(201)
  const body = await response.json() as { runId: string }
  return body.runId
}

async function waitForStatus(manager: RunManager, runId: string, status: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (manager.getRun(runId)?.status === status) {
      return
    }
    await sleep(5)
  }
  throw new Error(`Run ${runId} did not enter ${status}`)
}

function questionEvents(manager: RunManager, runId: string, type = "question.requested"): RunEvent[] {
  return (manager.getEvents(runId) ?? []).filter((event) => event.type === type)
}

describe("Runtime question tool", () => {
  test("requests user input, enters waiting_input, and resumes with a tool-result answer", async () => {
    const { app, manager } = await createHarness()
    let executions = 0
    let resumedMessages: ModelMessage[] | undefined

    ;(manager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        executions += 1
        if (!context.resumeMessages) {
          context.onQuestionPending?.({
            calls: [{
              toolCallId: "tool_question_color",
              messageId: "msg_question_color",
              input: {
                questions: [{
                  id: "color",
                  title: "Choose a color",
                  body: "Which accent color should I use?",
                  options: [{ id: "blue", label: "Blue" }],
                  allowCustom: true,
                  required: true,
                }],
              },
            }],
            resumeMessages: [{
              role: "assistant",
              content: [],
            } as unknown as ModelMessage],
          })
          return
        }

        resumedMessages = context.resumeMessages
        yield createRunEvent(context.runId, "message.completed", context.agent.id, {
          content: "Thanks, I can continue.",
        })
        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    const runId = await startSingleCoderRun(app)
    await waitForStatus(manager, runId, "waiting_input")

    const requested = questionEvents(manager, runId)[0]
    expect(requested?.toolCallId).toBe("tool_question_color")
    expect(requested?.messageId).toBe("msg_question_color")
    const requestId = (requested?.data as { requestId?: string } | undefined)?.requestId
    expect(requestId).toBeTruthy()

    const response = await app.request(`/runtime/runs/${runId}/questions/${requestId}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        answers: [{ questionId: "color", optionId: "blue" }],
      }),
    })
    if (response.status !== 200) {
      throw new Error(JSON.stringify(await response.json()))
    }
    expect(response.status).toBe(200)

    await waitForStatus(manager, runId, "completed")
    expect(executions).toBe(2)
    expect(JSON.stringify(resumedMessages)).toContain("tool_question_color")
    expect(questionEvents(manager, runId, "question.answered")).toHaveLength(1)
    expect((manager.getEvents(runId) ?? []).some((event) =>
      event.type === "tool.completed" && event.toolName === "question"
    )).toBe(true)
  })

  test("waits for all question requests from one frame before resuming", async () => {
    const { app, manager } = await createHarness()
    let executions = 0

    ;(manager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        executions += 1
        if (!context.resumeMessages) {
          context.onQuestionPending?.({
            calls: ["first", "second"].map((suffix) => ({
              toolCallId: `tool_question_${suffix}`,
              input: {
                questions: [{
                  id: `choice_${suffix}`,
                  title: `Question ${suffix}`,
                  body: "Pick one option.",
                  options: [{ id: "ok", label: "OK" }],
                  required: true,
                }],
              },
            })),
            resumeMessages: [{
              role: "assistant",
              content: [],
            } as unknown as ModelMessage],
          })
          return
        }

        yield createRunEvent(context.runId, "agent.completed", context.agent.id, {
          status: "completed",
        })
      },
    }

    const runId = await startSingleCoderRun(app)
    await waitForStatus(manager, runId, "waiting_input")
    const requests = questionEvents(manager, runId)
    expect(requests).toHaveLength(2)

    const firstRequestId = (requests[0]?.data as { requestId?: string } | undefined)?.requestId
    const secondRequestId = (requests[1]?.data as { requestId?: string } | undefined)?.requestId
    const firstResponse = await app.request(`/runtime/runs/${runId}/questions/${firstRequestId}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        answers: [{ questionId: "choice_first", optionId: "ok" }],
      }),
    })
    if (firstResponse.status !== 200) {
      throw new Error(JSON.stringify(await firstResponse.json()))
    }
    await sleep(20)
    expect(manager.getRun(runId)?.status).toBe("waiting_input")
    expect(executions).toBe(1)

    const secondResponse = await app.request(`/runtime/runs/${runId}/questions/${secondRequestId}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        answers: [{ questionId: "choice_second", optionId: "ok" }],
      }),
    })
    if (secondResponse.status !== 200) {
      throw new Error(JSON.stringify(await secondResponse.json()))
    }
    await waitForStatus(manager, runId, "completed")
    expect(executions).toBe(2)
  })

  test("cancels pending question requests when a run is cancelled", async () => {
    const { app, manager } = await createHarness()
    ;(manager as any).aiSdkExecutor = {
      executorType: "ai-sdk",
      async *execute(context: AgentExecutionContext): AsyncIterable<RunEvent> {
        context.onQuestionPending?.({
          calls: [{
            toolCallId: "tool_question_cancel",
            input: {
              questions: [{
                id: "confirm",
                title: "Confirm",
                body: "Should I continue?",
                options: [{ id: "yes", label: "Yes" }],
              }],
            },
          }],
          resumeMessages: [{
            role: "assistant",
            content: [],
          } as unknown as ModelMessage],
        })
      },
    }

    const runId = await startSingleCoderRun(app)
    await waitForStatus(manager, runId, "waiting_input")
    manager.cancelRun(runId)

    expect(manager.getRun(runId)?.status).toBe("cancelled")
    expect(questionEvents(manager, runId, "question.cancelled")).toHaveLength(1)
    expect((manager.getEvents(runId) ?? []).some((event) =>
      event.type === "tool.failed" &&
      event.toolName === "question" &&
      (event.data as { error?: { code?: string } }).error?.code === "QUESTION_CANCELLED"
    )).toBe(true)
  })

  test("injects question for AI SDK agents while keeping it out of authoring options", async () => {
    const { registry } = await createHarness()
    const coder = registry.getAgent("coder")
    const opencode = registry.getAgent("opencode")
    const custom = await registry.createUserAgent({
      id: "custom_question_agent",
      name: "Custom Question Agent",
      description: "Asks clarifying questions.",
      systemPrompt: "Ask useful questions.",
      capabilities: [],
      allowedSubagents: [],
      allowedTools: [],
      permissionPolicy: {
        filesystem: "none",
        shell: "none",
        network: "none",
        deploy: "none",
      },
      enabled: true,
    })

    expect(coder?.allowedTools).toContain("question")
    expect(custom.allowedTools).toEqual(["question"])
    expect(opencode?.allowedTools).not.toContain("question")
    expect(createDefaultRuntimeToolRegistry().listUserConfigurableTools().map((tool) => tool.id))
      .not.toContain("question")
  })
})
