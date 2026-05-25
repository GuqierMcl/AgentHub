import type { OrchestratorRiskLevel } from "../types"
import type { ExternalAccessGrant } from "../workspace"

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
  approvalId?: string
  workspaceRequestId?: string
  data?: Record<string, unknown>
  grant?: ExternalAccessGrant
  decisionReason?: string
  createdAt: string
  resolvedAt?: string
}

export type RuntimePermissionDecision = {
  approved: boolean
  reason?: string
}

