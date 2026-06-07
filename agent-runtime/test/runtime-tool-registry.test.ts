import { describe, expect, test } from "bun:test"
import { createRunEvent, type AgentExecutionContext, type RunEvent, type RunInput, type TaskExecutionResult } from "../src/runtime"
import type { AgentDefinition } from "../src/agents"
import { RuntimeToolRegistry, createRunTaskTool, createWritePlanTool } from "../src/runtime/tools"
import type { ToolDefinition } from "../src/runtime/tools"
import { z } from "zod"

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
  allowedTools: ["write_plan", "run_task"],
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

const visibleTool: ToolDefinition<{}, { ok: boolean }> = {
  name: "ls",
  displayName: "List files",
  description: "List visible files",
  category: "workspace",
  inputSchema: z.object({}),
  riskLevel: "low",
  requiredPermissions: { filesystem: "read" },
  approvalPolicy: "never",
  configurableByUserAgent: true,
  async execute() {
    return {
      status: "completed",
      summary: "ok",
      data: {
        ok: true,
      },
    }
  },
}

const userOriginTool: ToolDefinition<{}, { ok: boolean }> = {
  name: "grep",
  displayName: "Grep",
  description: "Search visible files",
  category: "workspace",
  inputSchema: z.object({}),
  riskLevel: "low",
  requiredPermissions: { filesystem: "read" },
  approvalPolicy: "never",
  configurableByUserAgent: true,
  async execute() {
    return {
      status: "completed",
      summary: "ok",
      data: {
        ok: true,
      },
    }
  },
}

describe("RuntimeToolRegistry", () => {
  test("write_plan emits a UI-renderable plan through tool events only", async () => {
    const registry = new RuntimeToolRegistry()
    registry.register(createWritePlanTool())

    const { context, events } = createBaseContext()
    const result = await registry.executeTool(
      "write_plan",
      {
        intent: "Inspect the project and summarize findings.",
        summaryInstruction: "Summarize the delegated result for the user.",
        tasks: [
          {
            taskId: "task_coder_scan",
            title: "Inspect workspace",
            targetAgentId: "coder",
            instruction: "Inspect the workspace and report one concrete observation.",
            expectedOutput: "One concise workspace observation.",
            riskLevel: "low",
            dependsOn: [],
            status: "pending",
          },
        ],
      },
      context,
      { toolCallId: "tool_plan" }
    )

    expect(result.status).toBe("completed")
    expect((result.data as { plan: { tasks: Array<{ taskId: string }> } }).plan.tasks[0]?.taskId).toBe("task_coder_scan")

    const eventTypes = events.map((event) => event.type)
    expect(eventTypes).toEqual(["tool.started", "tool.completed"])
    expect(events.every((event) => event.toolName === "write_plan")).toBe(true)
    expect(events.some((event) => event.type.startsWith("task."))).toBe(false)

    const completed = events.find((event) => event.type === "tool.completed")
    const completedData = completed?.data as { data?: { plan?: { tasks: unknown[] } } } | undefined
    expect(completedData?.data?.plan?.tasks).toHaveLength(1)
  })

  test("latest successful write_plan tool completion represents the current plan", async () => {
    const registry = new RuntimeToolRegistry()
    registry.register(createWritePlanTool())

    const { context, events } = createBaseContext()

    await registry.executeTool(
      "write_plan",
      {
        intent: "Initial plan",
        summaryInstruction: "Summarize initial plan.",
        tasks: [],
      },
      context,
      { toolCallId: "tool_plan_1" }
    )

    await registry.executeTool(
      "write_plan",
      {
        intent: "Updated plan",
        summaryInstruction: "Summarize updated plan.",
        tasks: [
          {
            taskId: "task_updated",
            title: "Updated task",
            targetAgentId: "coder",
            instruction: "Do the updated task.",
            expectedOutput: "Updated result.",
            riskLevel: "low",
            dependsOn: [],
            status: "pending",
          },
        ],
      },
      context,
      { toolCallId: "tool_plan_2" }
    )

    const planCompletedEvents = events.filter((event) =>
      event.type === "tool.completed" && event.toolName === "write_plan"
    )
    const latest = planCompletedEvents.at(-1)?.data as { data?: { plan?: { intent: string } } } | undefined

    expect(planCompletedEvents).toHaveLength(2)
    expect(latest?.data?.plan?.intent).toBe("Updated plan")
  })

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

  test("run_task accepts normalized declarative lock paths and passes them to delegated tasks", async () => {
    const registry = new RuntimeToolRegistry()
    registry.register(createRunTaskTool())

    let observedLockPaths: string[] | undefined
    const { context } = createBaseContext({
      runTask: async (task, options) => {
        observedLockPaths = task.lockPaths
        return {
          taskId: task.taskId,
          targetAgentId: task.targetAgentId,
          status: "completed",
          summary: "Task completed with declared file locks.",
          dependsOn: task.dependsOn,
          lockPaths: task.lockPaths,
          groupId: options?.groupId,
          parentTaskId: options?.parentTaskId,
          data: {},
          events: [],
        }
      },
    })

    const result = await registry.executeTool(
      "run_task",
      {
        targetAgentId: "explore",
        title: "Edit known files",
        instruction: "Update the declared files.",
        expectedOutput: "Updated files",
        requiredCapabilities: ["file-write"],
        riskLevel: "medium",
        dependsOn: [],
        lockPaths: ["src\\App.tsx", "./src/utils/format.ts"],
      },
      context,
      { toolCallId: "tool_declared_locks" }
    )

    expect(result.status).toBe("completed")
    expect(observedLockPaths).toEqual(["src/App.tsx", "src/utils/format.ts"])
    expect(result.data).toMatchObject({
      lockPaths: ["src/App.tsx", "src/utils/format.ts"],
    })
  })

  test("run_task rejects invalid lock paths before task execution begins", async () => {
    const registry = new RuntimeToolRegistry()
    registry.register(createRunTaskTool())

    let executed = false
    const { context, events } = createBaseContext({
      runTask: async (task) => {
        executed = true
        return {
          taskId: task.taskId,
          targetAgentId: task.targetAgentId,
          status: "completed",
          summary: "Unexpected execution",
          dependsOn: task.dependsOn,
          lockPaths: task.lockPaths,
          events: [],
        }
      },
    })

    const result = await registry.executeTool(
      "run_task",
      {
        targetAgentId: "explore",
        title: "Invalid lock path",
        instruction: "This should not execute.",
        expectedOutput: "Nothing",
        lockPaths: ["../outside.ts"],
      },
      context,
      { toolCallId: "tool_invalid_lock_path" }
    )

    expect(result.status).toBe("failed")
    expect(result.error?.code).toBe("TOOL_INVALID_INPUT")
    expect(executed).toBe(false)
    expect(events.some((event) => event.type === "task.started")).toBe(false)
    expect(events.filter((event) => event.type === "tool.failed")).toHaveLength(1)
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
    registry.register(createWritePlanTool())
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

    events.length = 0

    const invalidPlan = await registry.executeTool(
      "write_plan",
      {
        intent: "",
        summaryInstruction: "Summarize.",
        tasks: [],
      },
      context
    )

    expect(invalidPlan.status).toBe("failed")
    expect(invalidPlan.error?.code).toBe("TOOL_INVALID_INPUT")
    expect(events.filter((event) => event.type === "tool.failed")).toHaveLength(1)
    expect(events.some((event) => event.type.startsWith("task."))).toBe(false)
  })

  test("agent allowedTools is the only registry visibility boundary", async () => {
    const registry = new RuntimeToolRegistry()
    registry.register(visibleTool)
    registry.register(userOriginTool)

    const agentWithLs: AgentDefinition = {
      ...orchestratorAgent,
      id: "coder",
      name: "Coder",
      entryPolicy: "callable",
      executorType: "ai-sdk",
      allowedTools: ["ls"],
      permissionPolicy: {
        filesystem: "read",
        shell: "none",
        network: "none",
        deploy: "none",
      },
    }
    const allowedContext = createBaseContext({
      agent: agentWithLs,
    }).context

    expect(registry.listToolsForAgent(agentWithLs).map((definition) => definition.name)).toEqual(["ls"])

    const allowed = await registry.executeTool("ls", {}, allowedContext)
    expect(allowed.status).toBe("completed")

    const blocked = await registry.executeTool("grep", {}, allowedContext)
    expect(blocked.status).toBe("failed")
    expect(blocked.error?.code).toBe("TOOL_NOT_ALLOWED")

    const agentWithGrep: AgentDefinition = {
      ...agentWithLs,
      id: "custom_writer",
      name: "Custom Writer",
      origin: "user",
      allowedTools: ["grep"],
      readonly: false,
    }

    expect(registry.listToolsForAgent(agentWithGrep).map((definition) => definition.name)).toEqual(["grep"])
  })

  test("visible tools still require the agent capability policy at execution time", async () => {
    const registry = new RuntimeToolRegistry()
    registry.register(visibleTool)
    const { context, events } = createBaseContext({
      agent: {
        ...orchestratorAgent,
        id: "restricted_reader",
        allowedTools: ["ls"],
      },
    })

    expect(registry.listToolsForAgent(context.agent).map((definition) => definition.name)).toEqual(["ls"])
    const result = await registry.executeTool("ls", {}, context)
    expect(result.status).toBe("failed")
    expect(result.error?.code).toBe("TOOL_PERMISSION_DENIED")
    expect(events.some((event) => event.type === "tool.failed")).toBe(true)
    expect(events.some((event) => event.type === "tool.started")).toBe(false)
  })

  test("buildAiSdkToolSettings keeps internal tools visible only for orchestrator internal mode", () => {
    const registry = new RuntimeToolRegistry()
    registry.register(createWritePlanTool())
    registry.register(createRunTaskTool())
    registry.register(visibleTool)

    const orchestratorContext = createBaseContext({
      agent: {
        ...orchestratorAgent,
        allowedTools: ["write_plan", "run_task", "ls"],
      },
    }).context

    const orchestratorSettings = registry.buildAiSdkToolSettings(orchestratorContext, {
      includeInternal: true,
    })
    expect(orchestratorSettings?.activeTools).toEqual(["write_plan", "run_task", "ls"])

    const coderContext = createBaseContext({
      agent: {
        ...orchestratorAgent,
        id: "coder",
        name: "Coder",
        entryPolicy: "callable",
        modelRef: {
          providerId: "deepseek",
          modelId: "deepseek-v4-pro",
        },
        allowedTools: ["write_plan", "run_task", "ls"],
      },
    }).context

    const coderSettings = registry.buildAiSdkToolSettings(coderContext)
    expect(coderSettings?.activeTools).toEqual(["ls"])
    expect(coderSettings?.activeTools).not.toContain("write_plan")
    expect(coderSettings?.activeTools).not.toContain("run_task")
  })

  test("user agents can receive explicitly allowed non-internal tools", async () => {
    const registry = new RuntimeToolRegistry()
    registry.register(userOriginTool)

    const userAgent: AgentDefinition = {
      ...orchestratorAgent,
      id: "custom_writer",
      name: "Custom Writer",
      origin: "user",
      entryPolicy: "callable",
      executorType: "ai-sdk",
      allowedTools: ["grep"],
      permissionPolicy: {
        filesystem: "read",
        shell: "none",
        network: "none",
        deploy: "none",
      },
      readonly: false,
    }
    const { context, events } = createBaseContext({
      agent: userAgent,
    })

    const settings = registry.buildAiSdkToolSettings(context)
    expect(settings?.activeTools).toEqual(["grep"])

    const result = await registry.executeTool("grep", {}, context)
    expect(result.status).toBe("completed")
    expect(events.some((event) => event.type === "tool.completed" && event.toolName === "grep")).toBe(true)

    const blockedContext = createBaseContext({
      agent: {
        ...userAgent,
        allowedTools: [],
      },
    }).context
    const blocked = await registry.executeTool("grep", {}, blockedContext)
    expect(blocked.status).toBe("failed")
    expect(blocked.error?.code).toBe("TOOL_NOT_ALLOWED")
  })
})
