import { createRunEvent } from "../run-events"
import type { RunEvent } from "../types"
import type { WorkspaceService } from "../workspace"
import type { ToolApprovalDraft, ToolExecutionContext } from "../tools"
import type { RuntimePermissionDecision, RuntimePermissionRequest } from "./types"

export class RuntimePermissionError extends Error {
  constructor(
    public code:
      | "PERMISSION_NOT_FOUND"
      | "PERMISSION_ALREADY_RESOLVED"
      | "PERMISSION_GRANT_FAILED"
      | "PERMISSION_RUN_NOT_ACTIVE",
    message: string,
    public status: 404 | 409,
  ) {
    super(message)
    this.name = "RuntimePermissionError"
  }
}

export class RuntimePermissionService {
  private requests = new Map<string, RuntimePermissionRequest>()
  private requestsByToolCall = new Map<string, string>()

  constructor(private workspaceService?: WorkspaceService) {}

  stageToolApproval(
    context: ToolExecutionContext,
    toolName: string,
    draft: ToolApprovalDraft
  ): RuntimePermissionRequest {
    const key = `${context.runId}|${context.toolCallId}`
    const existingId = this.requestsByToolCall.get(key)
    if (existingId) {
      const existing = this.requests.get(existingId)
      if (existing) {
        return existing
      }
    }

    const request: RuntimePermissionRequest = {
      requestId: `permission_${crypto.randomUUID()}`,
      runId: context.runId,
      agentId: context.agent.id,
      toolCallId: context.toolCallId,
      toolName,
      riskLevel: draft.riskLevel,
      status: "pending",
      reason: draft.reason,
      executionId: context.executionId,
      messageId: context.getCurrentMessageId?.(),
      parentAgentId: context.parentAgentId,
      taskId: context.task?.taskId,
      groupId: context.groupId,
      parentTaskId: context.parentTaskId,
      workspaceRequestId: draft.workspaceRequestId,
      data: draft.data,
      createdAt: new Date().toISOString(),
    }
    this.requests.set(request.requestId, request)
    this.requestsByToolCall.set(key, request.requestId)
    context.emitEvent(this.createEvent(request, "permission.requested"))
    return request
  }

  bindAiSdkApproval(runId: string, toolCallId: string, approvalId: string): RuntimePermissionRequest | null {
    const requestId = this.requestsByToolCall.get(`${runId}|${toolCallId}`)
    const request = requestId ? this.requests.get(requestId) : undefined
    if (!request) {
      return null
    }

    request.approvalId = approvalId
    return request
  }

  listRequests(runId: string): RuntimePermissionRequest[] {
    return Array.from(this.requests.values()).filter((request) => request.runId === runId)
  }

  getRequest(requestId: string): RuntimePermissionRequest | null {
    return this.requests.get(requestId) ?? null
  }

  getRequestForToolCall(runId: string, toolCallId: string): RuntimePermissionRequest | null {
    const requestId = this.requestsByToolCall.get(`${runId}|${toolCallId}`)
    return requestId ? this.requests.get(requestId) ?? null : null
  }

  decide(
    requestId: string,
    decision: RuntimePermissionDecision,
    emitEvent: (event: RunEvent) => void
  ): RuntimePermissionRequest {
    const request = this.requests.get(requestId)
    if (!request) {
      throw new RuntimePermissionError("PERMISSION_NOT_FOUND", `Permission request ${requestId} not found`, 404)
    }
    if (request.status !== "pending") {
      throw new RuntimePermissionError(
        "PERMISSION_ALREADY_RESOLVED",
        `Permission request ${requestId} has already been resolved`,
        409
      )
    }

    if (decision.approved && request.workspaceRequestId) {
      const grant = this.workspaceService?.approveAccess(request.workspaceRequestId)
      if (!grant) {
        throw new RuntimePermissionError(
          "PERMISSION_GRANT_FAILED",
          `Unable to grant access for permission request ${requestId}`,
          409
        )
      }
      const { rootPath: _rootPath, targetPath: _targetPath, ...publicGrant } = grant
      request.grant = {
        ...publicGrant,
        logicalPath: typeof request.data?.logicalPath === "string" ? request.data.logicalPath : undefined,
      }
    }

    request.status = decision.approved ? "approved" : "denied"
    request.decisionReason = decision.reason
    request.resolvedAt = new Date().toISOString()
    emitEvent(this.createEvent(request, decision.approved ? "permission.approved" : "permission.denied"))
    return request
  }

  cancelPendingForRun(runId: string, emitEvent: (event: RunEvent) => void): void {
    for (const request of this.listRequests(runId).filter((candidate) => candidate.status === "pending")) {
      request.status = "cancelled"
      request.resolvedAt = new Date().toISOString()
      emitEvent(this.createEvent(request, "permission.cancelled"))
    }
  }

  private createEvent(
    request: RuntimePermissionRequest,
    type: "permission.requested" | "permission.approved" | "permission.denied" | "permission.cancelled"
  ): RunEvent {
    const event = createRunEvent(request.runId, type, request.agentId, request)
    event.toolCallId = request.toolCallId
    event.toolName = request.toolName
    event.messageId = request.messageId
    event.parentAgentId = request.parentAgentId ?? request.agentId
    event.taskId = request.taskId
    event.parentTaskId = request.parentTaskId
    event.groupId = request.groupId
    return event
  }
}
