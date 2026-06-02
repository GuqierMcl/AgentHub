import type { AgentDefinition } from "../../agents"
import type {
  AgentExecutionContext,
  AgentExecutor,
  ExternalContextPacket,
  OrchestratorTask,
  RunEvent,
  RunWorkspaceSnapshot,
} from "../types"

export type ExternalSessionScope = "conversation-visible" | "delegated-task"

export type ExternalSessionLink = {
  provider: string
  agentId: string
  scope: ExternalSessionScope
  providerSessionId: string
  conversationId: string
  workspaceId: string
  parentProviderSessionId?: string
  taskId?: string
  runId?: string
  handoffSummary?: string
}

export type ExternalAdapterPrompt = {
  content: string
  scope: ExternalSessionScope
  task?: OrchestratorTask
  externalContext?: ExternalContextPacket
}

export type ExternalAdapterContext = AgentExecutionContext & {
  agent: AgentDefinition & {
    external: NonNullable<AgentDefinition["external"]>
  }
  scope: ExternalSessionScope
  workspace: RunWorkspaceSnapshot
}

export type ExternalAgentAdapter = {
  provider: NonNullable<AgentDefinition["external"]>["provider"]
  execute(context: ExternalAdapterContext): AsyncIterable<RunEvent>
}

export type ExternalAdapterRegistry = {
  getAdapter(provider: string): ExternalAgentAdapter | null
}

export type ExternalAdapterExecutorDependencies = {
  registry?: ExternalAdapterRegistry
}

export type ExternalAdapterExecutorLike = AgentExecutor

export type ExternalAdapterErrorCode =
  | "ADAPTER_CONFIG_MISSING"
  | "ADAPTER_NOT_AVAILABLE"
  | "ADAPTER_WORKSPACE_REQUIRED"
  | "ADAPTER_EXECUTION_FAILED"
  | "ADAPTER_SERVER_START_FAILED"
  | "ADAPTER_SERVER_UNHEALTHY"
  | "ADAPTER_WORKSPACE_MISMATCH"
  | "ADAPTER_SESSION_FAILED"
  | "ADAPTER_PROMPT_FAILED"
  | "ADAPTER_ABORT_FAILED"

export class ExternalAdapterError extends Error {
  constructor(
    public code: ExternalAdapterErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message)
    this.name = "ExternalAdapterError"
  }
}
