export { LocalWorkspaceBackend } from "./local-workspace-backend"
export { WorkspaceService } from "./workspace-service"
export type {
  ExternalAccessGrant,
  ExternalAccessRequest,
  SandboxPolicy,
  WorkspaceAccessAllowed,
  WorkspaceAccessApprovalRequired,
  WorkspaceAccessDenied,
  WorkspaceAccessNotFound,
  WorkspaceAccessResolution,
  WorkspaceBackend,
  WorkspaceBackendCapabilities,
  WorkspaceContentBlock,
  WorkspaceError,
  WorkspaceErrorCode,
  WorkspaceGrepMatch,
  WorkspaceHandle,
  WorkspaceListEntry,
  WorkspaceReadFileResult,
  WorkspaceTargetKind,
  WorkspaceAccessMode,
} from "./types"

declare module "hono" {
  interface ContextVariableMap {
    workspaceService: import("./workspace-service").WorkspaceService
  }
}
