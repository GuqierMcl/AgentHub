import { z } from "zod"
import type { DeploymentService, DeploymentToolEventContext } from "../deployment"
import { DefaultDeploymentService } from "../deployment"
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolPreflightDecision,
} from "./types"

const DEFAULT_COMMAND_TIMEOUT_MS = 300_000
const MAX_COMMAND_TIMEOUT_MS = 1_800_000
const DEFAULT_MAX_OUTPUT_BYTES = 131_072
const MAX_OUTPUT_BYTES = 1_048_576

export const ListDeployServersInputSchema = z.object({}).strict()

export const ConnectDeployServerInputSchema = z.object({
  serverId: z.string().trim().min(1).max(200),
  deploymentId: z.string().trim().min(1).max(200).optional(),
  reason: z.string().trim().min(1).max(1_000).optional(),
}).strict()

export const RunDeployCommandInputSchema = z.object({
  connectionId: z.string().trim().min(1).max(200),
  command: z.string().trim().min(1).max(20_000),
  cwd: z.string().trim().min(1).max(1_000).optional(),
  reason: z.string().trim().min(1).max(1_000),
  timeoutMs: z.number().int().positive().max(MAX_COMMAND_TIMEOUT_MS).optional().default(DEFAULT_COMMAND_TIMEOUT_MS),
  maxOutputBytes: z.number().int().positive().max(MAX_OUTPUT_BYTES).optional().default(DEFAULT_MAX_OUTPUT_BYTES),
}).strict()

export const UpdateDeploymentStatusInputSchema = z.object({
  deploymentId: z.string().trim().min(1).max(200).optional(),
  connectionId: z.string().trim().min(1).max(200).optional(),
  percent: z.number().min(0).max(100).optional(),
  currentStep: z.number().int().positive().optional(),
  totalSteps: z.number().int().positive().optional(),
  stepId: z.string().trim().min(1).max(120).optional(),
  stepTitle: z.string().trim().min(1).max(200).optional(),
  message: z.string().trim().min(1).max(2_000),
  releaseNote: z.string().trim().min(1).max(8_000).optional(),
  deploymentUrl: z.string().url().optional(),
  status: z.enum(["running", "completed", "failed", "cancelled"]).optional(),
}).strict()

export const CloseDeployConnectionInputSchema = z.object({
  connectionId: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(1_000).optional(),
}).strict()

export const UploadDeployArtifactInputSchema = z.object({
  connectionId: z.string().trim().min(1).max(200),
  localPath: z.string().trim().min(1).max(1_000),
  remotePath: z.string().trim().min(1).max(1_000),
  mode: z.enum(["file", "directory"]).optional().default("file"),
  reason: z.string().trim().min(1).max(1_000),
}).strict()

export const CheckDeploymentUrlInputSchema = z.object({
  deploymentId: z.string().trim().min(1).max(200).optional(),
  connectionId: z.string().trim().min(1).max(200).optional(),
  url: z.string().url(),
  timeoutMs: z.number().int().positive().max(60_000).optional().default(15_000),
  expectedStatus: z.number().int().min(100).max(599).optional(),
  openPreview: z.boolean().optional().default(false),
}).strict()

export type ListDeployServersInput = z.infer<typeof ListDeployServersInputSchema>
export type ConnectDeployServerInput = z.infer<typeof ConnectDeployServerInputSchema>
export type RunDeployCommandInput = z.infer<typeof RunDeployCommandInputSchema>
export type UpdateDeploymentStatusInput = z.infer<typeof UpdateDeploymentStatusInputSchema>
export type CloseDeployConnectionInput = z.infer<typeof CloseDeployConnectionInputSchema>
export type UploadDeployArtifactInput = z.infer<typeof UploadDeployArtifactInputSchema>
export type CheckDeploymentUrlInput = z.infer<typeof CheckDeploymentUrlInputSchema>

export type DeploymentToolFactoryOptions = {
  deploymentService?: DeploymentService
}

function isApprovedToolCall(context: ToolExecutionContext): boolean {
  const request = context.permissionService?.getRequestForToolCall(context.runId, context.toolCallId)
  return request?.status === "approved"
}

function serviceUnavailable(toolName: string): ToolExecutionResult {
  return {
    status: "failed",
    summary: "Deployment service is not configured",
    error: {
      code: "DEPLOYMENT_SERVICE_UNAVAILABLE",
      message: `${toolName} cannot run because the deployment service is not configured`,
    },
  }
}

async function prepareCommandApproval(
  service: DeploymentService,
  input: RunDeployCommandInput,
  context: ToolExecutionContext
): Promise<ToolPreflightDecision | null> {
  if (isApprovedToolCall(context)) {
    return { type: "allow" }
  }

  let approvalContext
  try {
    approvalContext = await service.getCommandApprovalContext(input, context)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Deployment command context is unavailable"
    return {
      type: "deny",
      result: {
        status: "failed",
        summary: message,
        error: {
          code: "DEPLOYMENT_CONNECTION_NOT_AVAILABLE",
          message,
        },
      },
    }
  }

  const cwd = input.cwd ?? approvalContext.cwd
  return {
    type: "ask",
    approval: {
      reason: `${context.agent.name} wants to run a remote deployment command on ${approvalContext.server.displayName}.`,
      riskLevel: "high",
      data: {
        permissionType: "deployment",
        approvalReason: "deployment_command",
        serverDisplayName: approvalContext.server.displayName,
        user: approvalContext.server.user,
        command: input.command,
        cwd,
        reason: input.reason,
      },
    },
  }
}

function toDeploymentEventContext(
  toolName: string,
  context: ToolExecutionContext
): DeploymentToolEventContext {
  return {
    runId: context.runId,
    conversationId: context.input.conversationId,
    agentId: context.agent.id,
    toolCallId: context.toolCallId,
    toolName,
    emitEvent: context.emitEvent,
  }
}

export function createDeploymentTools(
  options: DeploymentToolFactoryOptions = {}
): ToolDefinition[] {
  const service = options.deploymentService ?? new DefaultDeploymentService()

  const tools: ToolDefinition[] = [
    {
      name: "list_deploy_servers",
      displayName: "List Deploy Servers",
      description: "List configured remote deployment servers using sanitized display metadata only.",
      category: "deployment",
      inputSchema: ListDeployServersInputSchema,
      riskLevel: "low",
      requiredPermissions: { deploy: "preview" },
      approvalPolicy: "never",
      configurableByUserAgent: false,
      execute: async (_input, context) => service.listServers?.(context) ?? serviceUnavailable("list_deploy_servers"),
    },
    {
      name: "connect_deploy_server",
      displayName: "Connect Deploy Server",
      description: "Open a managed SSH connection to one configured deployment server by server id.",
      category: "deployment",
      inputSchema: ConnectDeployServerInputSchema,
      riskLevel: "high",
      requiredPermissions: { deploy: "publish" },
      approvalPolicy: "never",
      configurableByUserAgent: false,
      execute: async (input, context) => service.connectServer?.(input, context) ?? serviceUnavailable("connect_deploy_server"),
    },
    {
      name: "run_deploy_command",
      displayName: "Run Deploy Command",
      description: "Run an approved remote command through an existing deployment SSH connection.",
      category: "deployment",
      inputSchema: RunDeployCommandInputSchema,
      riskLevel: "high",
      requiredPermissions: { deploy: "publish" },
      approvalPolicy: "contextual",
      configurableByUserAgent: false,
      prepareExecution: (input, context) => prepareCommandApproval(service, input as RunDeployCommandInput, context),
      execute: async (input, context) => service.runCommand(
        input as RunDeployCommandInput,
        toDeploymentEventContext("run_deploy_command", context)
      ),
    },
    {
      name: "update_deployment_status",
      displayName: "Update Deployment Status",
      description: "Update deployment progress, current step, release note, URL, or terminal status for the deployment preview.",
      category: "deployment",
      inputSchema: UpdateDeploymentStatusInputSchema,
      riskLevel: "low",
      requiredPermissions: { deploy: "preview" },
      approvalPolicy: "never",
      configurableByUserAgent: false,
      execute: async (input, context) => service.updateStatus?.(input, context) ?? serviceUnavailable("update_deployment_status"),
    },
    {
      name: "close_deploy_connection",
      displayName: "Close Deploy Connection",
      description: "Close an active deployment SSH connection.",
      category: "deployment",
      inputSchema: CloseDeployConnectionInputSchema,
      riskLevel: "medium",
      requiredPermissions: { deploy: "publish" },
      approvalPolicy: "never",
      configurableByUserAgent: false,
      execute: async (input, context) => service.closeConnection?.(input, context) ?? serviceUnavailable("close_deploy_connection"),
    },
    {
      name: "upload_deploy_artifact",
      displayName: "Upload Deploy Artifact",
      description: "Upload or synchronize a deployment artifact through an active deployment SSH connection.",
      category: "deployment",
      inputSchema: UploadDeployArtifactInputSchema,
      riskLevel: "high",
      requiredPermissions: { deploy: "publish" },
      approvalPolicy: "contextual",
      configurableByUserAgent: false,
      prepareExecution: async (_input) => ({ type: "allow" }),
      execute: async (input, context) => service.uploadArtifact?.(input, context) ?? serviceUnavailable("upload_deploy_artifact"),
    },
    {
      name: "check_deployment_url",
      displayName: "Check Deployment URL",
      description: "Check a deployment URL and optionally request the preview tab to open it.",
      category: "deployment",
      inputSchema: CheckDeploymentUrlInputSchema,
      riskLevel: "low",
      requiredPermissions: { deploy: "preview" },
      approvalPolicy: "never",
      configurableByUserAgent: false,
      execute: async (input, context) => service.checkUrl?.(input, context) ?? serviceUnavailable("check_deployment_url"),
    },
  ]

  return tools
}
