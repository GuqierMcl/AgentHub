import { tool, type ToolSet } from "ai"
import { createRunEvent } from "../run-events"
import type { AgentExecutionContext, RunEvent } from "../types"
import type {
  AiSdkToolSettings,
  RuntimeToolExecuteOptions,
  RuntimeToolListOptions,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types"

export class RuntimeToolRegistry {
  private tools = new Map<string, ToolDefinition<any, any, any>>()

  register<TInput, TData = unknown, TRuntime = unknown>(
    definition: ToolDefinition<TInput, TData, TRuntime>
  ): void {
    this.tools.set(definition.name, definition)
  }

  getTool(name: string): ToolDefinition<any, any, any> | null {
    return this.tools.get(name) ?? null
  }

  listToolsForAgent(
    agentId: string,
    options: RuntimeToolListOptions = {}
  ): ToolDefinition<any, any, any>[] {
    const allowedToolNames = options.allowedToolNames
      ? new Set(options.allowedToolNames)
      : null

    return Array.from(this.tools.values())
      .filter((definition) => definition.allowedAgents.includes(agentId))
      .filter((definition) => !allowedToolNames || allowedToolNames.has(definition.name))
      .filter((definition) => options.includeInternal || definition.name !== "run_task")
  }

  hasVisibleToolsForAgent(agentId: string, options: RuntimeToolListOptions = {}): boolean {
    return this.listToolsForAgent(agentId, options).length > 0
  }

  async executeTool(
    name: string,
    input: unknown,
    baseContext: AgentExecutionContext,
    options: RuntimeToolExecuteOptions = {}
  ): Promise<ToolExecutionResult> {
    const definition = this.tools.get(name)
    const toolCallId = options.toolCallId ?? `tool_${crypto.randomUUID()}`
    const context = this.buildContext(baseContext, toolCallId, options)

    if (!definition) {
      return this.failBeforeStart(context, name, "TOOL_NOT_FOUND", `Tool ${name} is not registered`)
    }

    if (!definition.allowedAgents.includes(context.agent.id)) {
      return this.failBeforeStart(
        context,
        name,
        "TOOL_NOT_ALLOWED",
        `Agent ${context.agent.id} is not allowed to use tool ${name}`
      )
    }

    const parsed = definition.inputSchema.safeParse(input)
    if (!parsed.success) {
      return this.failBeforeStart(
        context,
        name,
        "TOOL_INVALID_INPUT",
        `Invalid input for tool ${name}`,
        parsed.error.issues
      )
    }

    this.emitToolEvent(context, "tool.started", definition.name, {
      riskLevel: definition.riskLevel,
      input: parsed.data,
    })

    try {
      const result = await definition.execute(parsed.data, context)
      const terminalType = result.status === "completed" ? "tool.completed" : "tool.failed"
      this.emitToolEvent(context, terminalType, definition.name, {
        status: result.status,
        summary: result.summary,
        data: result.data,
        error: result.error,
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed"
      const result: ToolExecutionResult = {
        status: context.signal.aborted ? "cancelled" : "failed",
        summary: message,
        error: {
          code: context.signal.aborted ? "TOOL_EXECUTION_ABORTED" : "TOOL_EXECUTION_FAILED",
          message,
        },
      }
      this.emitToolEvent(context, "tool.failed", definition.name, {
        status: result.status,
        summary: result.summary,
        error: result.error,
      })
      return result
    }
  }

  buildAiSdkToolSettings(baseContext: AgentExecutionContext): AiSdkToolSettings | null {
    const visibleTools = this.listToolsForAgent(baseContext.agent.id, {
      allowedToolNames: baseContext.agent.allowedTools,
    })
    if (visibleTools.length === 0) {
      return null
    }

    const tools: ToolSet = {}
    for (const definition of visibleTools) {
      const needsApproval = definition.requiresApproval
      tools[definition.name] = tool({
        description: definition.description,
        inputSchema: definition.inputSchema,
        needsApproval: typeof needsApproval === "boolean"
          ? needsApproval
          : async (input, options) => needsApproval(input, this.buildContext(baseContext, options.toolCallId, {
              signal: baseContext.signal,
            })),
        execute: async (input, options) => {
          const result = await this.executeTool(definition.name, input, baseContext, {
            toolCallId: options.toolCallId,
            signal: options.abortSignal,
          })

          return {
            status: result.status,
            summary: result.summary,
            data: result.data,
            error: result.error,
          }
        },
      })
    }

    return {
      tools,
      activeTools: visibleTools.map((definition) => definition.name),
    }
  }

  private buildContext(
    baseContext: AgentExecutionContext,
    toolCallId: string,
    options: RuntimeToolExecuteOptions
  ): ToolExecutionContext {
    return {
      runId: baseContext.runId,
      input: baseContext.input,
      agent: baseContext.agent,
      signal: options.signal ?? baseContext.signal,
      toolCallId,
      parentAgentId: options.parentAgentId ?? baseContext.parentAgentId,
      groupId: options.groupId ?? baseContext.groupId,
      parentTaskId: options.parentTaskId ?? baseContext.parentTaskId,
      task: options.task ?? baseContext.task,
      emitEvent: baseContext.emitEvent ?? (() => {}),
      workspaceService: baseContext.workspaceService,
      runTask: baseContext.runTask,
    }
  }

  private failBeforeStart(
    context: ToolExecutionContext,
    toolName: string,
    code: string,
    message: string,
    details?: unknown
  ): ToolExecutionResult {
    const result: ToolExecutionResult = {
      status: "failed",
      summary: message,
      error: {
        code,
        message,
        details,
      },
    }

    this.emitToolEvent(context, "tool.failed", toolName, {
      status: result.status,
      summary: result.summary,
      error: result.error,
    })
    return result
  }

  private emitToolEvent(
    context: ToolExecutionContext,
    type: "tool.started" | "tool.completed" | "tool.failed",
    toolName: string,
    data: unknown
  ): void {
    const event: RunEvent = createRunEvent(context.runId, type, context.agent.id, data)
    event.toolCallId = context.toolCallId
    event.toolName = toolName
    event.taskId = context.task?.taskId
    event.parentAgentId = context.parentAgentId ?? context.agent.id
    event.parentTaskId = context.parentTaskId
    event.groupId = context.groupId
    context.emitEvent(event)
  }
}
