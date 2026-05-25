import type { z } from "zod"
import type { ToolSet } from "ai"
import type { AgentDefinition } from "../../agents"
import type { WorkspaceService } from "../workspace"
import type {
  OrchestratorRiskLevel,
  OrchestratorTask,
  RunEvent,
  RunInput,
  TaskExecutionResult,
} from "../types"

export type ToolExecutionStatus = "completed" | "failed" | "cancelled"

export type ToolExecutionResult<
  TData = unknown,
  TRuntime = unknown,
> = {
  status: ToolExecutionStatus
  summary: string
  data?: TData
  error?: {
    code: string
    message: string
    details?: unknown
  }
  runtime?: TRuntime
}

export type ToolExecutionContext = {
  runId: string
  input: RunInput
  agent: AgentDefinition
  signal: AbortSignal
  toolCallId: string
  parentAgentId?: string
  groupId?: string
  parentTaskId?: string
  task?: OrchestratorTask
  emitEvent: (event: RunEvent) => void
  workspaceService?: WorkspaceService
  executeTask?: (task: OrchestratorTask, options?: {
    groupId?: string
    parentTaskId?: string
  }) => Promise<TaskExecutionResult>
  runTask?: (task: OrchestratorTask, options?: {
    groupId?: string
    parentTaskId?: string
  }) => Promise<TaskExecutionResult>
}

export type ToolDefinition<TInput = unknown, TData = unknown, TRuntime = unknown> = {
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
  riskLevel: OrchestratorRiskLevel
  requiresApproval: boolean | ((input: TInput, context: ToolExecutionContext) => boolean | Promise<boolean>)
  allowedAgents: string[]
  internal?: boolean
  execute(input: TInput, context: ToolExecutionContext): Promise<ToolExecutionResult<TData, TRuntime>>
}

export type RuntimeToolExecuteOptions = {
  toolCallId?: string
  parentAgentId?: string
  groupId?: string
  parentTaskId?: string
  task?: OrchestratorTask
  signal?: AbortSignal
}

export type RuntimeToolListOptions = {
  includeInternal?: boolean
  allowedToolNames?: string[]
}

export type AiSdkToolSettings = {
  tools: ToolSet
  activeTools: string[]
}
