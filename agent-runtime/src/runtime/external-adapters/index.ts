export { ExternalAdapterExecutor } from "./external-adapter-executor"
export { DefaultExternalAdapterRegistry } from "./registry"
export { OpenCodeAdapter } from "./opencode-adapter"
export { FakeOpenCodeClient } from "./opencode-client"
export {
  createDefaultOpenCodeClient,
  extractAssistantText,
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
export { ExternalAdapterError } from "./types"
