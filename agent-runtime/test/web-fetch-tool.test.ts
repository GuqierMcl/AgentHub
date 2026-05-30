import { afterEach, describe, expect, test } from "bun:test"
import { RuntimePermissionService } from "../src/runtime/permissions"
import {
  RuntimeToolRegistry,
  createDefaultRuntimeToolRegistry,
  createWebFetchTool,
} from "../src/runtime/tools"
import type { AgentDefinition } from "../src/agents"
import { presetAgents } from "../src/agents"
import type { AgentExecutionContext, RunEvent, RunInput } from "../src/runtime"

const originalFetch = globalThis.fetch
type MockFetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>

const runInput: RunInput = {
  conversationId: "conv_web_fetch",
  mode: "single",
  participantAgentIds: ["coder"],
  addressedAgentIds: ["coder"],
  userMessage: {
    role: "user",
    content: "Fetch a URL.",
  },
  history: [],
}

const networkFullAgent: AgentDefinition = {
  id: "coder",
  name: "Coder",
  description: "Test coder",
  tier: "primary",
  origin: "system",
  visibility: "visible",
  entryPolicy: "callable",
  delegationPolicy: "can-delegate",
  executorType: "ai-sdk",
  capabilities: ["implementation"],
  allowedSubagents: [],
  allowedTools: ["web_fetch"],
  permissionPolicy: {
    filesystem: "none",
    shell: "none",
    network: "full",
    deploy: "none",
  },
  enabled: true,
  readonly: true,
}

function createContext(overrides: Partial<AgentExecutionContext> = {}): {
  context: AgentExecutionContext
  events: RunEvent[]
  permissionService: RuntimePermissionService
} {
  const events: RunEvent[] = []
  const permissionService = new RuntimePermissionService()
  const context: AgentExecutionContext = {
    runId: "run_web_fetch",
    input: runInput,
    agent: networkFullAgent,
    signal: new AbortController().signal,
    permissionService,
    emitEvent: (event) => {
      events.push(event)
    },
    ...overrides,
  }

  return {
    context,
    events,
    permissionService,
  }
}

function createRegistry(): RuntimeToolRegistry {
  const registry = new RuntimeToolRegistry()
  registry.register(createWebFetchTool())
  return registry
}

function mockFetch(handler: MockFetch): void {
  globalThis.fetch = handler as unknown as typeof globalThis.fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("web_fetch tool", () => {
  test("invalid input returns TOOL_INVALID_INPUT before execution", async () => {
    const registry = createRegistry()
    const { context, events } = createContext()

    const result = await registry.executeTool("web_fetch", { url: "not-a-url" }, context)

    expect(result.status).toBe("failed")
    expect(result.error?.code).toBe("TOOL_INVALID_INPUT")
    expect(events.some((event) => event.type === "tool.started")).toBe(false)
    expect(events.some((event) => event.type === "tool.failed")).toBe(true)
  })

  test("allowedTools and network policy gate execution", async () => {
    const registry = createRegistry()

    const notAllowed = await registry.executeTool(
      "web_fetch",
      { url: "https://example.com" },
      createContext({
        agent: {
          ...networkFullAgent,
          allowedTools: [],
        },
      }).context
    )
    expect(notAllowed.status).toBe("failed")
    expect(notAllowed.error?.code).toBe("TOOL_NOT_ALLOWED")

    const noNetwork = await registry.executeTool(
      "web_fetch",
      { url: "https://example.com" },
      createContext({
        agent: {
          ...networkFullAgent,
          allowedTools: ["web_fetch"],
          permissionPolicy: {
            ...networkFullAgent.permissionPolicy,
            network: "none",
          },
        },
      }).context
    )
    expect(noNetwork.status).toBe("failed")
    expect(noNetwork.error?.code).toBe("TOOL_PERMISSION_DENIED")
  })

  test("network limited requests approval and resumes the same toolCallId after approval", async () => {
    const registry = createRegistry()
    const { context, events, permissionService } = createContext({
      agent: {
        ...networkFullAgent,
        permissionPolicy: {
          ...networkFullAgent.permissionPolicy,
          network: "limited",
        },
      },
    })

    const first = await registry.executeTool(
      "web_fetch",
      { url: "https://example.com/search?q=secret", method: "GET" },
      context,
      { toolCallId: "tool_fetch_approval" }
    )
    expect(first.status).toBe("failed")
    expect(first.error?.code).toBe("TOOL_APPROVAL_REQUIRED")
    expect(events.some((event) => event.type === "permission.requested")).toBe(true)
    expect(events.some((event) => event.type === "tool.started")).toBe(false)

    const request = permissionService.getRequestForToolCall("run_web_fetch", "tool_fetch_approval")
    expect(request?.data).toMatchObject({
      permissionType: "network_access",
      approvalReason: "network_request",
      method: "GET",
      host: "example.com",
      url: "https://example.com/search?redacted",
    })

    permissionService.decide(request!.requestId, { approved: true }, (event) => {
      events.push(event)
    })
    events.length = 0

    mockFetch(async () => new Response("approved body", {
      status: 200,
      headers: {
        "content-type": "text/plain",
      },
    }))

    const second = await registry.executeTool(
      "web_fetch",
      { url: "https://example.com/search?q=secret", method: "GET" },
      context,
      { toolCallId: "tool_fetch_approval" }
    )

    expect(second.status).toBe("completed")
    expect((second.data as { body: string }).body).toBe("approved body")
    expect(events.some((event) => event.type === "permission.requested")).toBe(false)
    expect(events.map((event) => event.type)).toEqual(["tool.started", "tool.completed"])
  })

  test("network full executes directly and treats HTTP 500 as a completed result", async () => {
    const registry = createRegistry()
    const { context, events } = createContext()
    let requestedMethod = ""

    mockFetch(async (_input, init) => {
      requestedMethod = init?.method ?? ""
      return new Response("server error text", {
        status: 500,
        statusText: "Server Error",
        headers: {
          "content-type": "text/plain",
          authorization: "Bearer token",
        },
      })
    })

    const result = await registry.executeTool(
      "web_fetch",
      { url: "https://example.com/fail", method: "POST", body: "payload" },
      context,
      { toolCallId: "tool_direct" }
    )

    expect(requestedMethod).toBe("POST")
    expect(result.status).toBe("completed")
    expect((result.data as { statusCode: number }).statusCode).toBe(500)
    expect((result.data as { body: string }).body).toBe("server error text")
    expect((result.data as { headers: Record<string, string> }).headers.authorization).toBe("[redacted]")
    expect(events.some((event) => event.type === "permission.requested")).toBe(false)
    expect(events.map((event) => event.type)).toEqual(["tool.started", "tool.completed"])
  })

  test("timeouts, oversized responses, unsupported protocols, and cancellation fail clearly", async () => {
    const registry = createRegistry()
    const { context } = createContext()

    mockFetch(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new Error("aborted"))
      })
    }))
    const timeout = await registry.executeTool(
      "web_fetch",
      { url: "https://example.com/slow", timeoutMs: 1 },
      context
    )
    expect(timeout.status).toBe("failed")
    expect(timeout.error?.code).toBe("NETWORK_TIMEOUT")

    mockFetch(async () => new Response("abcdef"))
    const oversized = await registry.executeTool(
      "web_fetch",
      { url: "https://example.com/large", maxResponseBytes: 3 },
      context
    )
    expect(oversized.status).toBe("failed")
    expect(oversized.error?.code).toBe("NETWORK_RESPONSE_TOO_LARGE")
    expect((oversized.data as { truncated: boolean }).truncated).toBe(true)

    const protocol = await registry.executeTool(
      "web_fetch",
      { url: "ftp://example.com/file" },
      context
    )
    expect(protocol.status).toBe("failed")
    expect(protocol.error?.code).toBe("NETWORK_UNSUPPORTED_PROTOCOL")

    const abortController = new AbortController()
    abortController.abort()
    mockFetch(async (_input, init) => {
      if (init?.signal?.aborted) {
        throw new Error("aborted")
      }
      return new Response("unexpected")
    })
    const cancelled = await registry.executeTool(
      "web_fetch",
      { url: "https://example.com/cancelled" },
      createContext({ signal: abortController.signal }).context
    )
    expect(cancelled.status).toBe("cancelled")
    expect(cancelled.error?.code).toBe("TOOL_EXECUTION_ABORTED")
  })

  test("default registry registers web_fetch while user authoring options hide it", () => {
    const registry = createDefaultRuntimeToolRegistry()
    const internalPrimaryAgents = presetAgents.filter((agent) =>
      agent.tier === "primary" &&
      agent.origin === "system" &&
      agent.executorType !== "external-adapter"
    )

    for (const agent of internalPrimaryAgents) {
      expect(agent.allowedTools).toContain("web_fetch")
      expect(agent.permissionPolicy.network).toBe("full")
      expect(registry.listToolsForAgent(agent, { includeInternal: true }).map((tool) => tool.name)).toContain("web_fetch")
    }

    const opencode = presetAgents.find((agent) => agent.id === "opencode")
    expect(opencode?.permissionPolicy.network).toBe("full")
    expect(opencode?.allowedTools).toEqual([])
    expect(registry.getTool("web_fetch")).toBeTruthy()
    expect(registry.listUserConfigurableTools().map((tool) => tool.id)).not.toContain("web_fetch")
  })
})
