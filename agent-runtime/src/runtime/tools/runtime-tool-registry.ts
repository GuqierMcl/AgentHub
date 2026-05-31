import { tool, type ToolSet } from "ai"
import { createRunEvent } from "../run-events"
import type { AgentExecutionContext, RunEvent } from "../types"
import type {
  AiSdkToolSettings,
  RuntimeToolExecuteOptions,
  RuntimeToolListOptions,
  ToolApprovalDraft,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolPreflightDecision,
} from "./types"
import type { AgentAuthoringToolOption, AgentPermissionPolicy } from "../../agents"
import { createBashTool } from "./bash-tool"
import { createQuestionTool } from "./question-tool"
import { createRunTaskTool } from "./run-task-tool"
import { createWebFetchTool } from "./web-fetch-tool"
import { createWorkspaceTools } from "./workspace-tools"
import { createWritePlanTool } from "./write-plan-tool"

const PERMISSION_RANKS = {
  filesystem: { none: 0, read: 1, write: 2 },
  shell: { none: 0, limited: 1, full: 2 },
  network: { none: 0, limited: 1, full: 2 },
  deploy: { none: 0, preview: 1, publish: 2 },
} as const

function hasRequiredPermissions(
  policy: AgentPermissionPolicy,
  required: Partial<Pick<AgentPermissionPolicy, "filesystem" | "shell" | "network" | "deploy">>
): boolean {
  return (
    (!required.filesystem || PERMISSION_RANKS.filesystem[policy.filesystem] >= PERMISSION_RANKS.filesystem[required.filesystem]) &&
    (!required.shell || PERMISSION_RANKS.shell[policy.shell] >= PERMISSION_RANKS.shell[required.shell]) &&
    (!required.network || PERMISSION_RANKS.network[policy.network] >= PERMISSION_RANKS.network[required.network]) &&
    (!required.deploy || PERMISSION_RANKS.deploy[policy.deploy] >= PERMISSION_RANKS.deploy[required.deploy])
  )
}

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
    agent: AgentExecutionContext["agent"],
    options: RuntimeToolListOptions = {}
  ): ToolDefinition<any, any, any>[] {
    const declaredTools = new Set(agent.allowedTools)

    return Array.from(this.tools.values())
      .filter((definition) => declaredTools.has(definition.name))
      .filter((definition) => options.includeInternal || !definition.internal)
  }

  listUserConfigurableTools(): AgentAuthoringToolOption[] {
    return Array.from(this.tools.values())
      .filter((definition) => definition.configurableByUserAgent && !definition.internal)
      .map((definition) => ({
        id: definition.name,
        name: definition.displayName,
        description: definition.description,
        category: definition.category,
        riskLevel: definition.riskLevel,
        approvalPolicy: definition.approvalPolicy,
        requiredPermissions: definition.requiredPermissions,
      }))
  }

  hasVisibleToolsForAgent(
    agent: AgentExecutionContext["agent"],
    options: RuntimeToolListOptions = {}
  ): boolean {
    return this.listToolsForAgent(agent, options).length > 0
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

    if (!context.agent.allowedTools.includes(definition.name)) {
      return this.failBeforeStart(
        context,
        name,
        "TOOL_NOT_ALLOWED",
        `Agent ${context.agent.id} is not allowed to use tool ${name}`
      )
    }

    if (!hasRequiredPermissions(context.agent.permissionPolicy, definition.requiredPermissions)) {
      return this.failBeforeStart(
        context,
        name,
        "TOOL_PERMISSION_DENIED",
        `Agent ${context.agent.id} does not have the permissions required by tool ${name}`,
        {
          requiredPermissions: definition.requiredPermissions,
          permissionPolicy: context.agent.permissionPolicy,
        }
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

    const preflight = await this.prepareToolExecution(definition, parsed.data, context)
    if (preflight?.type === "deny") {
      return this.failWithResultBeforeStart(context, name, preflight.result)
    }
    if (preflight?.type === "ask") {
      return this.requestToolApproval(context, definition.name, preflight.approval)
    }

    if (
      definition.approvalPolicy === "contextual" &&
      definition.prepareApproval &&
      context.permissionService
    ) {
      const draft = await definition.prepareApproval(parsed.data, context)
      if (draft) {
        return this.requestToolApproval(context, definition.name, draft)
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
    baseContext: AgentExecutionContext,
    options: RuntimeToolListOptions = {}
  ): AiSdkToolSettings | null {
    const visibleTools = this.listToolsForAgent(baseContext.agent, {
      includeInternal: options.includeInternal,
    })
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
        needsApproval: async (input, options) => {
          if (definition.approvalPolicy === "never") {
            return false
          }

          const context = this.buildContext(baseContext, options.toolCallId, {
            signal: baseContext.signal,
          })
          if (definition.approvalPolicy === "always") {
            context.permissionService?.stageToolApproval(context, definition.name, {
              reason: `Tool ${definition.name} requires approval`,
              riskLevel: definition.riskLevel,
            })
            return true
          }

          const parsed = definition.inputSchema.safeParse(input)
          if (parsed.success && definition.prepareExecution) {
            const preflight = await definition.prepareExecution(parsed.data, context)
            if (preflight?.type === "ask") {
              context.permissionService?.stageToolApproval(context, definition.name, preflight.approval)
              return true
            }
            return false
          }

          const draft = definition.prepareApproval
            ? await definition.prepareApproval(input, context)
            : null
          if (!draft) {
            return false
          }
          context.permissionService?.stageToolApproval(context, definition.name, draft)
          return true
        },
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
      permissionService: baseContext.permissionService,
      executionId: baseContext.executionId,
      executeTask: baseContext.executeTask,
      runTask: baseContext.runTask,
      getCurrentMessageId: baseContext.getCurrentMessageId,
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

  private failWithResultBeforeStart(
    context: ToolExecutionContext,
    toolName: string,
    result: ToolExecutionResult
  ): ToolExecutionResult {
    this.emitToolEvent(context, "tool.failed", toolName, {
      status: result.status,
      summary: result.summary,
      data: result.data,
      error: result.error,
    })
    return result
  }

  private requestToolApproval(
    context: ToolExecutionContext,
    toolName: string,
    draft: ToolApprovalDraft
  ): ToolExecutionResult {
    context.permissionService?.stageToolApproval(context, toolName, draft)
    return {
      status: "failed",
      summary: `${toolName} is waiting for approval`,
      error: {
        code: "TOOL_APPROVAL_REQUIRED",
        message: `Tool ${toolName} requires approval before execution`,
      },
    }
  }

  private async prepareToolExecution<TInput, TData, TRuntime>(
    definition: ToolDefinition<TInput, TData, TRuntime>,
    input: TInput,
    context: ToolExecutionContext
  ): Promise<ToolPreflightDecision<TData, TRuntime> | null> {
    if (
      definition.approvalPolicy !== "contextual" ||
      !definition.prepareExecution
    ) {
      return null
    }

    return definition.prepareExecution(input, context)
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
    event.taskId = context.task?.taskId
    event.parentAgentId = context.parentAgentId ?? context.agent.id
    event.parentTaskId = context.parentTaskId
    event.groupId = context.groupId
    context.emitEvent(event)
  }
}

export function createDefaultRuntimeToolRegistry(): RuntimeToolRegistry {
  const registry = new RuntimeToolRegistry()
  registry.register(createWritePlanTool())
  registry.register(createRunTaskTool())
  for (const definition of createWorkspaceTools()) {
    registry.register(definition)
  }
  registry.register(createWebFetchTool())
  registry.register(createBashTool())
  registry.register(createQuestionTool())
  return registry
}
