export { ExternalAdapterExecutor } from "./external-adapter-executor"
export { DefaultExternalAdapterRegistry } from "./registry"
export { ClaudeCodeAdapter } from "./claude-code-adapter"
export { FakeClaudeCodeClient } from "./claude-code-client"
export {
  createDefaultClaudeCodeClient,
  getClaudeCodeReadiness,
  RealClaudeCodeClient,
} from "./claude-code-real-client"
export { OpenCodeAdapter } from "./opencode-adapter"
export { FakeOpenCodeClient } from "./opencode-client"
export {
  createDefaultOpenCodeClient,
  extractAssistantText,
  getDefaultOpenCodeServer,
  RealOpenCodeClient,
} from "./opencode-real-client"
export {
  detectOpenCodeSdkWorkspaceOption,
  ManagedOpenCodeServer,
  unwrapOpenCodeResponse,
} from "./opencode-server"
export type {
  OpenCodeClient,
  OpenCodeExecutionAgent,
  OpenCodeExternalModel,
  OpenCodePromptEvent,
  OpenCodePromptRequest,
  OpenCodeSessionRequest,
} from "./opencode-client"
export type {
  ManagedOpenCodeServerDependencies,
  OpenCodeApiClient,
  OpenCodeClientFactory,
  OpenCodeConnectionMode,
  OpenCodeManagedServerLifecycleStatus,
  OpenCodeManagedServerStatus,
  OpenCodeProcessLauncher,
  OpenCodeSdkManagedFactory,
  OpenCodeSdkWorkspaceOption,
  OpenCodeServerHandle,
  OpenCodeWorkspaceConnection,
} from "./opencode-server"
export type {
  ExternalAdapterContext,
  ExternalAdapterExecutorDependencies,
  ExternalAdapterExecutorLike,
  ExternalAdapterPrompt,
  ExternalAdapterRegistry,
  ExternalAgentAdapter,
  ExternalAdapterErrorCode,
  ExternalSessionLink,
  ExternalSessionScope,
} from "./types"
export type {
  ClaudeCodeClient,
  ClaudeCodeExternalModel,
  ClaudeCodePermissionDecision,
  ClaudeCodePermissionRequest,
  ClaudeCodePromptEvent,
  ClaudeCodePromptRequest,
  ClaudeCodeQuestionRequest,
  ClaudeCodeSessionRequest,
} from "./claude-code-client"
export { ExternalAdapterError } from "./types"
