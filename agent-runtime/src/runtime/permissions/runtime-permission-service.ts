import { createRunEvent } from "../run-events"
import type { RunEvent } from "../types"
import type { WorkspaceService } from "../workspace"
import type { ToolApprovalDraft, ToolExecutionContext } from "../tools"
import type {
  RuntimeExternalPermissionApprovalDraft,
  RuntimePermissionDecision,
  RuntimePermissionRequest,
} from "./types"

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
  private externalWaiters = new Map<string, {
    promise: Promise<RuntimePermissionDecision>
    resolve: (decision: RuntimePermissionDecision) => void
  }>()

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

  stageExternalApproval(
    draft: RuntimeExternalPermissionApprovalDraft,
    emitEvent: (event: RunEvent) => void
  ): Promise<RuntimePermissionDecision> {
    const key = `${draft.runId}|${draft.toolCallId}`
    const existingId = this.requestsByToolCall.get(key)
    if (existingId) {
      const existingWaiter = this.externalWaiters.get(existingId)
      if (existingWaiter) {
        return existingWaiter.promise
      }
      const existingRequest = this.requests.get(existingId)
      if (existingRequest && existingRequest.status !== "pending") {
        return Promise.resolve({
          approved: existingRequest.status === "approved",
          reason: existingRequest.decisionReason,
        })
      }
    }

    const request: RuntimePermissionRequest = {
      requestId: `permission_${crypto.randomUUID()}`,
      runId: draft.runId,
      agentId: draft.agentId,
      toolCallId: draft.toolCallId,
      toolName: draft.toolName,
      riskLevel: draft.riskLevel,
      status: "pending",
      reason: draft.reason,
      executionId: draft.executionId,
      messageId: draft.messageId,
      parentAgentId: draft.parentAgentId,
      taskId: draft.taskId,
      groupId: draft.groupId,
      parentTaskId: draft.parentTaskId,
      data: draft.data,
      createdAt: new Date().toISOString(),
    }

    let resolveDecision!: (decision: RuntimePermissionDecision) => void
    const promise = new Promise<RuntimePermissionDecision>((resolve) => {
      resolveDecision = resolve
    })
    this.requests.set(request.requestId, request)
    this.requestsByToolCall.set(key, request.requestId)
    this.externalWaiters.set(request.requestId, {
      promise,
      resolve: resolveDecision,
    })
    emitEvent(this.createEvent(request, "permission.requested"))
    return promise
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

  isExternalRequest(requestId: string): boolean {
    if (this.externalWaiters.has(requestId)) {
      return true
    }
    const request = this.requests.get(requestId)
    return typeof request?.data?.externalProvider === "string"
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
    const waiter = this.externalWaiters.get(requestId)
    if (waiter) {
      this.externalWaiters.delete(requestId)
      waiter.resolve({
        approved: decision.approved,
        reason: decision.reason,
      })
    }
    return request
  }

  cancelPendingForRun(runId: string, emitEvent: (event: RunEvent) => void): void {
    for (const request of this.listRequests(runId).filter((candidate) => candidate.status === "pending")) {
      request.status = "cancelled"
      request.resolvedAt = new Date().toISOString()
      emitEvent(this.createEvent(request, "permission.cancelled"))
      const waiter = this.externalWaiters.get(request.requestId)
      if (waiter) {
        this.externalWaiters.delete(request.requestId)
        waiter.resolve({
          approved: false,
          reason: "Run cancelled",
        })
      }
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
