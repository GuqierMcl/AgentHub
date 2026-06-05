import { tool, type ToolSet } from "ai"
import { createRunEvent } from "../../runtime/run-events"
import type { AgentExecutionContext, RunEvent } from "../../runtime/types"
import type {
  AiSdkToolSettings,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "../../runtime/tools"
import type { AgentDefinition, AgentPermissionPolicy } from "../../agents"
import { AgentStore } from "../../agents"
import { createQuestionTool } from "../../runtime/tools/question-tool"
import { createSaveAgentTool } from "./save-agent-tool"

export class InstructToolRegistry {
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
    agent: { allowedTools: string[] }
  ): ToolDefinition<any, any, any>[] {
    const declaredTools = new Set(agent.allowedTools)

    return Array.from(this.tools.values())
      .filter((definition) => declaredTools.has(definition.name))
  }

  hasVisibleToolsForAgent(
    agent: { allowedTools: string[] }
  ): boolean {
    return this.listToolsForAgent(agent).length > 0
  }

  async executeTool(
    name: string,
    input: unknown,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const definition = this.tools.get(name)
    if (!definition) {
      return {
        status: "failed",
        summary: `Tool ${name} is not registered`,
        error: {
          code: "TOOL_NOT_FOUND",
          message: `Tool ${name} is not registered`,
        },
      }
    }

    const parsed = definition.inputSchema.safeParse(input)
    if (!parsed.success) {
      return {
        status: "failed",
        summary: `Invalid input for tool ${name}`,
        error: {
          code: "TOOL_INVALID_INPUT",
          message: `Invalid input for tool ${name}`,
          details: parsed.error.issues,
        },
      }
    }

    this.emitToolEvent(context, "tool.started", definition.name, {
      riskLevel: definition.riskLevel,
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

  buildAiSdkToolSettings(
    baseContext: AgentExecutionContext
  ): AiSdkToolSettings | null {
    const visibleTools = this.listToolsForAgent(baseContext.agent)
    if (visibleTools.length === 0) {
      return null
    }

    const tools: ToolSet = {}
    for (const definition of visibleTools) {
      if (definition.deferred) {
        tools[definition.name] = tool({
          description: definition.description,
          inputSchema: definition.inputSchema,
        })
        continue
      }

        tools[definition.name] = tool({
          description: definition.description,
          inputSchema: definition.inputSchema,
          execute: async (input, options) => {
            const result = await this.executeTool(
              definition.name,
              input,
              this.buildContext(baseContext, options.toolCallId ?? `tool_${crypto.randomUUID()}`, {
                signal: options.abortSignal,
              })
            )
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
    options: { signal?: AbortSignal } = {}
  ): ToolExecutionContext {
    return {
      runId: baseContext.runId,
      input: baseContext.input,
      agent: baseContext.agent,
      signal: options.signal ?? baseContext.signal,
      toolCallId,
      parentAgentId: baseContext.parentAgentId,
      groupId: baseContext.groupId,
      parentTaskId: baseContext.parentTaskId,
      task: baseContext.task,
      executionId: baseContext.executionId,
      executeTask: baseContext.executeTask,
      runTask: baseContext.runTask,
      emitEvent: baseContext.emitEvent ?? (() => {}),
      workspaceService: baseContext.workspaceService,
      permissionService: baseContext.permissionService,
      getCurrentMessageId: baseContext.getCurrentMessageId,
    }
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
    event.messageId = context.getCurrentMessageId?.()
    context.emitEvent(event)
  }
}

export function createInstructRuntimeToolRegistry(
  dataDir: string,
  options: {
    onSavedAgent?: (agent: AgentDefinition) => Promise<void> | void
  } = {}
): InstructToolRegistry {
  const registry = new InstructToolRegistry()
  const store = new AgentStore(dataDir)
  registry.register(createQuestionTool())
  registry.register(createSaveAgentTool(store, options))
  return registry
}
