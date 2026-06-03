import type { OrchestratorRiskLevel } from "../types"
import type { ExternalAccessGrant } from "../workspace"

export type RuntimePermissionGrant = Omit<ExternalAccessGrant, "rootPath" | "targetPath"> & {
  logicalPath?: string
}

export type RuntimePermissionStatus = "pending" | "approved" | "denied" | "cancelled" | "expired"

export type RuntimePermissionRequest = {
  requestId: string
  runId: string
  agentId: string
  toolCallId: string
  toolName: string
  riskLevel: OrchestratorRiskLevel
  status: RuntimePermissionStatus
  reason: string
  executionId?: string
  messageId?: string
  parentAgentId?: string
  taskId?: string
  groupId?: string
  parentTaskId?: string
  approvalId?: string
  workspaceRequestId?: string
  data?: Record<string, unknown>
  grant?: RuntimePermissionGrant
  decisionReason?: string
  createdAt: string
  resolvedAt?: string
}

export type RuntimePermissionDecision = {
  approved: boolean
  reason?: string
}

export type RuntimeExternalPermissionApprovalDraft = {
  runId: string
  agentId: string
  toolCallId: string
  toolName: string
  riskLevel: OrchestratorRiskLevel
  reason: string
  executionId?: string
  messageId?: string
  parentAgentId?: string
  taskId?: string
  groupId?: string
  parentTaskId?: string
  data?: Record<string, unknown>
}
