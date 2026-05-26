import { describe, expect, test } from "bun:test"
import type { TextStreamPart, ToolSet } from "ai"
import {
  ModelStreamEventBuilder,
  resolveRunDiagnostics,
  sanitizeModelStreamPart,
  type AgentExecutionContext,
  type RunEvent,
  type RunInput,
} from "../src/runtime"
import type { AgentDefinition } from "../src/agents"

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
  conversationId: "conv_stream",
  mode: "single",
  participantAgentIds: ["coder"],
  addressedAgentIds: [],
  userMessage: {
    role: "user",
    content: "Think through the request.",
  },
  history: [],
}

function createContext(input: RunInput = baseInput): AgentExecutionContext {
  return {
    runId: "run_stream",
    input,
    agent,
    signal: new AbortController().signal,
    task: {
      taskId: "task_stream",
      targetAgentId: "coder",
      title: "Stream test",
      instruction: "Test model stream events.",
      expectedOutput: "Events",
      requiredCapabilities: [],
      riskLevel: "low",
      dependsOn: [],
    },
    parentAgentId: "orchestrator",
    parentTaskId: "task_parent",
    groupId: "group_stream",
  }
}

function part(value: Record<string, unknown>): TextStreamPart<ToolSet> {
  return value as unknown as TextStreamPart<ToolSet>
}

function eventData(event: RunEvent): Record<string, unknown> {
  return event.data as Record<string, unknown>
}

describe("model stream event helpers", () => {
  test("defaults enable model stream passthrough and reasoning events", () => {
    const builder = new ModelStreamEventBuilder(createContext())

    const startEvents = builder.createEvents(part({
      type: "reasoning-start",
      id: "reasoning_1",
    }))
    const deltaEvents = builder.createEvents(part({
      type: "reasoning-delta",
      id: "reasoning_1",
      text: "first thought",
    }))
    const endEvents = builder.createEvents(part({
      type: "reasoning-end",
      id: "reasoning_1",
    }))

    expect(startEvents.map((event) => event.type)).toEqual(["model.stream.part", "reasoning.started"])
    expect(deltaEvents.map((event) => event.type)).toEqual(["model.stream.part", "reasoning.delta"])
    expect(endEvents.map((event) => event.type)).toEqual(["model.stream.part", "reasoning.completed"])

    expect(eventData(deltaEvents[1]!).delta).toBe("first thought")
    expect(eventData(endEvents[1]!).content).toBe("first thought")
    expect(deltaEvents[0]?.taskId).toBe("task_stream")
    expect(deltaEvents[0]?.parentAgentId).toBe("orchestrator")
    expect(deltaEvents[0]?.parentTaskId).toBe("task_parent")
    expect(deltaEvents[0]?.groupId).toBe("group_stream")
  })

  test("includeReasoning false suppresses both reasoning passthrough and promoted reasoning events", () => {
    const builder = new ModelStreamEventBuilder(createContext({
      ...baseInput,
      diagnostics: {
        includeReasoning: false,
      },
    }))

    const reasoningEvents = builder.createEvents(part({
      type: "reasoning-delta",
      id: "reasoning_hidden",
      text: "hidden",
    }))
    const textEvents = builder.createEvents(part({
      type: "text-delta",
      id: "text_1",
      text: "visible",
    }))

    expect(reasoningEvents).toEqual([])
    expect(textEvents.map((event) => event.type)).toEqual(["model.stream.part"])
    expect(eventData(textEvents[0]!).partType).toBe("text-delta")
  })

  test("includeModelStream false keeps promoted reasoning events", () => {
    const builder = new ModelStreamEventBuilder(createContext({
      ...baseInput,
      diagnostics: {
        includeModelStream: false,
      },
    }))

    const events = builder.createEvents(part({
      type: "reasoning-delta",
      id: "reasoning_only",
      text: "semantic only",
    }))

    expect(events.map((event) => event.type)).toEqual(["reasoning.delta"])
    expect(eventData(events[0]!).delta).toBe("semantic only")
  })

  test("raw model chunks require explicit opt-in", () => {
    const hiddenRawBuilder = new ModelStreamEventBuilder(createContext())
    const visibleRawBuilder = new ModelStreamEventBuilder(createContext({
      ...baseInput,
      diagnostics: {
        includeRawModelChunks: true,
      },
    }))

    expect(hiddenRawBuilder.createEvents(part({
      type: "raw",
      rawValue: {
        provider: "test",
      },
    }))).toEqual([])

    const events = visibleRawBuilder.createEvents(part({
      type: "raw",
      rawValue: {
        provider: "test",
      },
    }))

    expect(events).toHaveLength(1)
    expect(eventData(events[0]!).partType).toBe("raw")
  })

  test("tool part passthrough carries tool identity metadata", () => {
    const builder = new ModelStreamEventBuilder(createContext())
    const events = builder.createEvents(part({
      type: "tool-call",
      toolCallId: "tool_call_1",
      toolName: "read_file",
      input: {
        path: "README.md",
      },
    }))

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe("model.stream.part")
    expect(events[0]?.toolCallId).toBe("tool_call_1")
    expect(events[0]?.toolName).toBe("read_file")
  })

  test("sanitizes non-json values and redacts known workspace paths", () => {
    const rootPath = "D:\\SensitiveWorkspace\\Project"
    const context = createContext({
      ...baseInput,
      workspace: {
        workspaceId: "workspace_sensitive",
        backendType: "local",
        rootPath,
      },
      diagnostics: {
        includeRawModelChunks: true,
      },
    })

    const sanitized = sanitizeModelStreamPart(part({
      type: "raw",
      rawValue: {
        count: 1n,
        error: new Error(`Failed at ${rootPath}\\secret.txt`),
        bytes: new Uint8Array([1, 2, 3]),
        nested: {
          path: `${rootPath}\\src\\index.ts`,
          externalPath: "E:\\Outside\\secret.txt",
        },
      },
    }), context) as {
      rawValue: {
        count: string
        error: { message: string }
        bytes: { byteLength: number }
        nested: { path: string; externalPath: string }
      }
    }

    expect(JSON.stringify(sanitized)).not.toContain(rootPath)
    expect(JSON.stringify(sanitized)).not.toContain(rootPath.replaceAll("\\", "/"))
    expect(sanitized.rawValue.count).toBe("1")
    expect(sanitized.rawValue.error.message).toContain("[workspace-root]")
    expect(sanitized.rawValue.bytes.byteLength).toBe(3)
    expect(sanitized.rawValue.nested.path).toContain("[workspace-root]")
    expect(sanitized.rawValue.nested.externalPath).toBe("[absolute-path]/secret.txt")
  })

  test("resolveRunDiagnostics applies stable defaults with partial overrides", () => {
    expect(resolveRunDiagnostics(baseInput)).toEqual({
      includeModelStream: true,
      includeReasoning: true,
      includeRawModelChunks: false,
    })
    expect(resolveRunDiagnostics({
      ...baseInput,
      diagnostics: {
        includeReasoning: false,
      },
    })).toEqual({
      includeModelStream: true,
      includeReasoning: false,
      includeRawModelChunks: false,
    })
  })
})
