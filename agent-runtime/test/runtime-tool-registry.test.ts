import { describe, expect, test } from "bun:test"
import { createRunEvent, type AgentExecutionContext, type RunEvent, type RunInput, type TaskExecutionResult } from "../src/runtime"
import type { AgentDefinition } from "../src/agents"
import { RuntimeToolRegistry, createRunTaskTool } from "../src/runtime/tools"

const orchestratorAgent: AgentDefinition = {
  id: "orchestrator",
  name: "Orchestrator",
  description: "Test orchestrator agent",
  tier: "primary",
  origin: "system",
  visibility: "visible",
  entryPolicy: "default",
  delegationPolicy: "can-delegate",
  executorType: "orchestrator",
  capabilities: ["routing", "delegation"],
  allowedSubagents: ["explore"],
  allowedTools: [],
  permissionPolicy: {
    filesystem: "none",
    shell: "none",
    network: "none",
    deploy: "none",
    requiresApproval: false,
  },
  enabled: true,
  readonly: true,
}

const runInput: RunInput = {
  conversationId: "conv_test",
  mode: "group",
  participantAgentIds: ["orchestrator", "coder"],
  addressedAgentIds: [],
  userMessage: {
    role: "user",
    content: "Delegate a task.",
  },
  history: [],
}

function createBaseContext(overrides: Partial<AgentExecutionContext> = {}): {
  context: AgentExecutionContext
  events: RunEvent[]
} {
  const events: RunEvent[] = []
  const context: AgentExecutionContext = {
    runId: "run_test",
    input: runInput,
    agent: orchestratorAgent,
    signal: new AbortController().signal,
    emitEvent: (event) => {
      events.push(event)
    },
    ...overrides,
  }

  return {
    context,
    events,
  }
}

function attachTaskMetadata(
  event: RunEvent,
  taskId: string,
  parentTaskId?: string,
  groupId?: string
): RunEvent {
  event.taskId = taskId
  event.parentAgentId = "orchestrator"
  event.parentTaskId = parentTaskId
  event.groupId = groupId
  return event
}

function asTaskResult(value: unknown): TaskExecutionResult | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const candidate = value as { taskResult?: TaskExecutionResult }
  return candidate.taskResult
}

describe("RuntimeToolRegistry", () => {
  test("run_task emits tool and task lifecycle events for a successful delegation", async () => {
    const registry = new RuntimeToolRegistry()
    registry.register(createRunTaskTool())

    const { context, events } = createBaseContext({
      runTask: async (task, options) => {
        const taskEvents: RunEvent[] = []
        const emitTaskEvent = (event: RunEvent): void => {
          events.push(event)
          taskEvents.push(event)
        }

        const started = attachTaskMetadata(
          createRunEvent("run_test", "task.started", "orchestrator", {
            taskId: task.taskId,
            targetAgentId: task.targetAgentId,
            title: task.title,
            instruction: task.instruction,
          }),
          task.taskId,
          options?.parentTaskId,
          options?.groupId
        )
        emitTaskEvent(started)

        const childStarted = attachTaskMetadata(
          createRunEvent("run_test", "agent.started", task.targetAgentId, {
            agentName: task.targetAgentId,
            executorType: "mock",
          }),
          task.taskId,
          options?.parentTaskId,
          options?.groupId
        )
        emitTaskEvent(childStarted)

        const delta = attachTaskMetadata(
          createRunEvent("run_test", "message.delta", task.targetAgentId, {
            delta: `${task.targetAgentId} handled ${task.title}.`,
          }),
          task.taskId,
          options?.parentTaskId,
          options?.groupId
        )
        emitTaskEvent(delta)

        const messageCompleted = attachTaskMetadata(
          createRunEvent("run_test", "message.completed", task.targetAgentId, {
            content: `${task.targetAgentId} handled ${task.title}.`,
          }),
          task.taskId,
          options?.parentTaskId,
          options?.groupId
        )
        emitTaskEvent(messageCompleted)

        const childCompleted = attachTaskMetadata(
          createRunEvent("run_test", "agent.completed", task.targetAgentId, {
            status: "completed",
          }),
          task.taskId,
          options?.parentTaskId,
          options?.groupId
        )
        emitTaskEvent(childCompleted)

        const taskCompleted = attachTaskMetadata(
          createRunEvent("run_test", "task.completed", "orchestrator", {
            taskId: task.taskId,
            targetAgentId: task.targetAgentId,
            summary: `${task.targetAgentId} handled ${task.title}.`,
          }),
          task.taskId,
          options?.parentTaskId,
          options?.groupId
        )
        emitTaskEvent(taskCompleted)

        return {
          taskId: task.taskId,
          targetAgentId: task.targetAgentId,
          status: "completed",
          summary: `${task.targetAgentId} handled ${task.title}.`,
          dependsOn: task.dependsOn,
          groupId: options?.groupId,
          parentTaskId: options?.parentTaskId,
          data: {
            eventCount: taskEvents.length,
          },
          events: taskEvents,
        }
      },
    })

    const result = await registry.executeTool(
      "run_task",
      {
        targetAgentId: "explore",
        title: "Collect context",
        instruction: "Gather supporting details.",
        expectedOutput: "Relevant context",
        requiredCapabilities: ["context"],
        riskLevel: "low",
        dependsOn: [],
      },
      context,
      { toolCallId: "tool_success" }
    )

    expect(result.status).toBe("completed")
    expect(asTaskResult(result.runtime)?.status).toBe("completed")

    const toolStarted = events.find((event) => event.type === "tool.started")
    const taskStarted = events.find((event) => event.type === "task.started")
    const taskCompleted = events.find((event) => event.type === "task.completed")
    const toolCompleted = events.find((event) => event.type === "tool.completed")

    expect(toolStarted?.toolCallId).toBe("tool_success")
    expect(toolStarted?.toolName).toBe("run_task")
    expect(toolCompleted?.toolCallId).toBe("tool_success")
    expect(toolCompleted?.toolName).toBe("run_task")
    expect(taskStarted?.taskId).toBeTruthy()
    expect(taskCompleted?.taskId).toBeTruthy()
    expect(events.findIndex((event) => event.type === "tool.started")).toBeLessThan(
      events.findIndex((event) => event.type === "task.started")
    )
    expect(events.findIndex((event) => event.type === "task.completed")).toBeLessThan(
      events.findIndex((event) => event.type === "tool.completed")
    )
  })

  test("concurrent run_task calls keep success and failure isolated", async () => {
    const registry = new RuntimeToolRegistry()
    registry.register(createRunTaskTool())

    const { context, events } = createBaseContext({
      runTask: async (task, options) => {
        const taskEvents: RunEvent[] = []
        const emitTaskEvent = (event: RunEvent): void => {
          events.push(event)
          taskEvents.push(event)
        }

        const delay = task.targetAgentId === "explore" ? 20 : 5
        await new Promise((resolve) => setTimeout(resolve, delay))

        const started = attachTaskMetadata(
          createRunEvent("run_test", "task.started", "orchestrator", {
            taskId: task.taskId,
            targetAgentId: task.targetAgentId,
            title: task.title,
            instruction: task.instruction,
          }),
          task.taskId,
          options?.parentTaskId,
          options?.groupId
        )
        emitTaskEvent(started)

        if (task.targetAgentId !== "explore") {
          const failed = attachTaskMetadata(
            createRunEvent("run_test", "task.failed", "orchestrator", {
              taskId: task.taskId,
              targetAgentId: task.targetAgentId,
              code: "TASK_TARGET_NOT_FOUND",
              message: `Target agent ${task.targetAgentId} does not exist`,
              details: {
                targetAgentId: task.targetAgentId,
              },
            }),
            task.taskId,
            options?.parentTaskId,
            options?.groupId
          )
          emitTaskEvent(failed)

          return {
            taskId: task.taskId,
            targetAgentId: task.targetAgentId,
            status: "failed",
            summary: `Target agent ${task.targetAgentId} does not exist`,
            dependsOn: task.dependsOn,
            groupId: options?.groupId,
            parentTaskId: options?.parentTaskId,
            data: {
              code: "TASK_TARGET_NOT_FOUND",
            },
            events: taskEvents,
          }
        }

        const childCompleted = attachTaskMetadata(
          createRunEvent("run_test", "agent.completed", task.targetAgentId, {
            status: "completed",
          }),
          task.taskId,
          options?.parentTaskId,
          options?.groupId
        )
        emitTaskEvent(childCompleted)

        const taskCompleted = attachTaskMetadata(
          createRunEvent("run_test", "task.completed", "orchestrator", {
            taskId: task.taskId,
            targetAgentId: task.targetAgentId,
            summary: `${task.targetAgentId} handled ${task.title}.`,
          }),
          task.taskId,
          options?.parentTaskId,
          options?.groupId
        )
        emitTaskEvent(taskCompleted)

        return {
          taskId: task.taskId,
          targetAgentId: task.targetAgentId,
          status: "completed",
          summary: `${task.targetAgentId} handled ${task.title}.`,
          dependsOn: task.dependsOn,
          groupId: options?.groupId,
          parentTaskId: options?.parentTaskId,
          data: {
            eventCount: taskEvents.length,
          },
          events: taskEvents,
        }
      },
    })

    const validPromise = registry.executeTool(
      "run_task",
      {
        targetAgentId: "explore",
        title: "Collect context",
        instruction: "Gather supporting details.",
        expectedOutput: "Relevant context",
        requiredCapabilities: ["context"],
        riskLevel: "low",
        dependsOn: [],
      },
      context,
      { toolCallId: "tool_valid" }
    )

    const invalidPromise = registry.executeTool(
      "run_task",
      {
        targetAgentId: "missing-agent",
        title: "Impossible task",
        instruction: "This should fail.",
        expectedOutput: "Nothing",
        requiredCapabilities: [],
        riskLevel: "low",
        dependsOn: [],
      },
      context,
      { toolCallId: "tool_invalid" }
    )

    const [validResult, invalidResult] = await Promise.all([validPromise, invalidPromise])

    expect(validResult.status).toBe("completed")
    expect(invalidResult.status).toBe("failed")
    expect(asTaskResult(validResult.runtime)?.status).toBe("completed")
    expect(asTaskResult(invalidResult.runtime)?.status).toBe("failed")

    const toolStartedEvents = events.filter((event) => event.type === "tool.started")
    const toolCompletedEvents = events.filter((event) => event.type === "tool.completed")
    const toolFailedEvents = events.filter((event) => event.type === "tool.failed")

    expect(toolStartedEvents).toHaveLength(2)
    expect(toolCompletedEvents).toHaveLength(1)
    expect(toolFailedEvents).toHaveLength(1)
    expect(new Set(toolStartedEvents.map((event) => event.toolCallId)).size).toBe(2)
    expect(toolStartedEvents.every((event) => event.toolName === "run_task")).toBe(true)
    expect(toolCompletedEvents[0]?.toolCallId).toBe("tool_valid")
    expect(toolFailedEvents[0]?.toolCallId).toBe("tool_invalid")
    expect(events.some((event) => event.type === "task.completed" && event.taskId === asTaskResult(validResult.runtime)?.taskId)).toBe(true)
    expect(events.some((event) => event.type === "task.failed" && event.taskId === asTaskResult(invalidResult.runtime)?.taskId)).toBe(true)
  })

  test("registry returns structured failures before tool execution begins", async () => {
    const registry = new RuntimeToolRegistry()
    registry.register(createRunTaskTool())

    const { context, events } = createBaseContext()

    const missingTool = await registry.executeTool("missing_tool", {}, context)
    expect(missingTool.status).toBe("failed")
    expect(missingTool.error?.code).toBe("TOOL_NOT_FOUND")
    expect(events.filter((event) => event.type === "tool.failed")).toHaveLength(1)

    events.length = 0

    const invalidInput = await registry.executeTool(
      "run_task",
      {
        targetAgentId: "",
      },
      context
    )

    expect(invalidInput.status).toBe("failed")
    expect(invalidInput.error?.code).toBe("TOOL_INVALID_INPUT")
    expect(events.filter((event) => event.type === "tool.failed")).toHaveLength(1)
    expect(events.some((event) => event.type === "task.started")).toBe(false)
  })
})
