export { LocalWorkspaceBackend } from "./local-workspace-backend"
export { WorkspaceService } from "./workspace-service"
export { DEFAULT_SANDBOX_POLICY, isSensitiveWorkspacePath } from "./sandbox-policy"
export { WorkspaceError } from "./types"
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
  WorkspaceErrorCode,
  WorkspaceGrepMatch,
  WorkspaceHandle,
  WorkspaceListEntry,
  WorkspaceReadFileResult,
  WorkspaceWriteFileResult,
  WorkspaceEditFilePatch,
  WorkspaceEditFileResult,
  WorkspaceTargetKind,
  WorkspaceAccessMode,
  WorkspaceReadApprovalReason,
  WorkspaceWriteApprovalReason,
  WorkspaceAccessApprovalReason,
} from "./types"

declare module "hono" {
  interface ContextVariableMap {
    workspaceService: import("./workspace-service").WorkspaceService
  }
}
