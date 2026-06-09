import type { RunEvent } from "../types"
import type { ToolExecutionContext, ToolExecutionResult } from "../tools/types"

export type DeploymentServerSummary = {
  id: string
  displayName: string
  hostLabel?: string
  port?: number
  user?: string
}

export type DeploymentCommandApprovalContext = {
  server: DeploymentServerSummary & {
    user: string
  }
  cwd?: string
}

export type DeploymentToolEventContext = {
  runId: string
  conversationId: string
  agentId: string
  toolCallId: string
  toolName: string
  emitEvent: (event: RunEvent) => void
}

export type DeploymentService = {
  listServers?(context: ToolExecutionContext): Promise<ToolExecutionResult>
  connectServer?(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>
  getCommandApprovalContext(
    input: unknown,
    context: ToolExecutionContext
  ): DeploymentCommandApprovalContext | Promise<DeploymentCommandApprovalContext>
  runCommand(input: unknown, context: DeploymentToolEventContext): Promise<ToolExecutionResult>
  updateStatus?(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>
  closeConnection?(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>
  closeConnectionById?(
    connectionId: string,
    emitEvent: (event: RunEvent) => void,
    reason?: string
  ): ToolExecutionResult
  closeRunConnections?(runId: string, emitEvent?: (event: RunEvent) => void): void
  uploadArtifact?(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>
  checkUrl?(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>
}

export type DeploymentRuntimeEventName =
  | "deployment.started"
  | "deployment.connection.changed"
  | "deployment.progress.updated"
  | "deployment.command.started"
  | "deployment.log.appended"
  | "deployment.command.completed"
  | "deployment.command.failed"
  | "deployment.release_note.updated"
  | "deployment.preview.requested"
  | "deployment.completed"
  | "deployment.failed"
  | "deployment.cancelled"
