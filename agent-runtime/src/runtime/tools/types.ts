import type { z } from "zod"
import type { ToolSet } from "ai"
import type { AgentDefinition, AgentPermissionPolicy, AgentAuthoringToolOption } from "../../agents"
import type { WorkspaceService } from "../workspace"
import type { RuntimePermissionService } from "../permissions"
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
  permissionService?: RuntimePermissionService
  executionId?: string
  executeTask?: (task: OrchestratorTask, options?: {
    groupId?: string
    parentTaskId?: string
  }) => Promise<TaskExecutionResult>
  runTask?: (task: OrchestratorTask, options?: {
    groupId?: string
    parentTaskId?: string
  }) => Promise<TaskExecutionResult>
  getCurrentMessageId?: () => string
}

export type ToolApprovalPolicy = "never" | "contextual" | "always"
export type ToolRequiredPermissions = Partial<Pick<AgentPermissionPolicy, "filesystem" | "shell" | "network" | "deploy">>

export type ToolApprovalDraft = {
  reason: string
  riskLevel: OrchestratorRiskLevel
  workspaceRequestId?: string
  data?: Record<string, unknown>
}

export type ToolPreflightDecision<TData = unknown, TRuntime = unknown> =
  | { type: "allow" }
  | { type: "ask"; approval: ToolApprovalDraft }
  | { type: "deny"; result: ToolExecutionResult<TData, TRuntime> }

export type ToolDefinition<TInput = unknown, TData = unknown, TRuntime = unknown> = {
  name: string
  displayName: string
  description: string
  category: string
  inputSchema: z.ZodType<TInput>
  riskLevel: OrchestratorRiskLevel
  requiredPermissions: ToolRequiredPermissions
  approvalPolicy: ToolApprovalPolicy
  configurableByUserAgent: boolean
  deferred?: boolean
  prepareExecution?: (input: TInput, context: ToolExecutionContext) => Promise<ToolPreflightDecision<TData, TRuntime> | null>
  prepareApproval?: (input: TInput, context: ToolExecutionContext) => Promise<ToolApprovalDraft | null>
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
}

export type AiSdkToolSettings = {
  tools: ToolSet
  activeTools: string[]
}

export type RuntimeToolCatalog = {
  listUserConfigurableTools(): AgentAuthoringToolOption[]
}
