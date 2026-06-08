import { z } from "zod"

export const WorkspaceAccessModeSchema = z.enum(["read", "write"])
export type WorkspaceAccessMode = z.infer<typeof WorkspaceAccessModeSchema>

export const WorkspaceTargetKindSchema = z.enum(["file", "directory"])
export type WorkspaceTargetKind = z.infer<typeof WorkspaceTargetKindSchema>

export type WorkspaceBackendCapabilities = {
  read: boolean
  write: boolean
  edit: boolean
  list: boolean
  glob: boolean
  grep: boolean
  imageRead: boolean
  snapshots: boolean
  externalMounts: boolean
}

export type WorkspaceHandle = {
  workspaceId: string
  backendType: string
  rootLabel: string
  rootPath: string
}

export type SandboxPolicy = {
  readOnly: boolean
  blockSensitivePaths: boolean
  allowExternalAccess: boolean
  blockedBasenames: string[]
  blockedExtensions: string[]
}

export type WorkspaceReadApprovalReason =
  | "external_read"
  | "sensitive_read"
  | "external_sensitive_read"

export type WorkspaceWriteApprovalReason =
  | "external_write"
  | "sensitive_write"
  | "external_sensitive_write"

export type WorkspaceAccessApprovalReason =
  | WorkspaceReadApprovalReason
  | WorkspaceWriteApprovalReason

export type WorkspaceContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string; encoding: "base64" }

export type WorkspaceReadFileResult = {
  path: string
  mimeType: string
  size: number
  blocks: WorkspaceContentBlock[]
}

export type WorkspaceWriteFileResult = {
  path: string
  size: number
  bytesWritten: number
  created: boolean
  overwritten: boolean
}

export type WorkspaceEditFilePatch = {
  search: string
  replace: string
  expectedReplacements?: number
}

export type WorkspaceEditFileDiff = {
  format: "unified"
  text: string
  truncated: boolean
  additions: number
  deletions: number
  contextLines: number
}

export type WorkspaceEditFileResult = {
  path: string
  size: number
  replacements: number
  changed: boolean
  diff?: WorkspaceEditFileDiff
}

export type WorkspaceListEntry = {
  path: string
  kind: "file" | "dir"
  size?: number
  mimeType?: string
}

export type WorkspaceGrepMatch = {
  path: string
  line: number
  snippet: string
}

export type WorkspaceErrorCode =
  | "WORKSPACE_ACCESS_DENIED"
  | "WORKSPACE_BINARY_FILE_UNSUPPORTED"
  | "WORKSPACE_EXTERNAL_ACCESS_PENDING_APPROVAL"
  | "WORKSPACE_NOT_A_DIRECTORY"
  | "WORKSPACE_NOT_A_FILE"
  | "WORKSPACE_PARENT_NOT_FOUND"
  | "WORKSPACE_PATH_NOT_FOUND"
  | "WORKSPACE_PATH_ALREADY_EXISTS"
  | "WORKSPACE_PATH_OUTSIDE_ROOT"
  | "WORKSPACE_SERVICE_UNAVAILABLE"
  | "WORKSPACE_NOT_BOUND"
  | "WORKSPACE_SENSITIVE_PATH_BLOCKED"
  | "WORKSPACE_SYMLINK_ESCAPE"
  | "WORKSPACE_EDIT_CONFLICT"
  | "WORKSPACE_UNSUPPORTED_OPERATION"

export class WorkspaceError extends Error {
  constructor(
    public code: WorkspaceErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message)
    this.name = "WorkspaceError"
  }
}

export type ExternalAccessRequest = {
  requestId: string
  runId: string
  workspaceId: string
  targetPath: string
  targetKind: WorkspaceTargetKind
  accessMode: WorkspaceAccessMode
  reason: string
  approvalReason: WorkspaceAccessApprovalReason
  logicalPath: string
  outsideWorkspace: boolean
  riskLevel: "low" | "medium" | "high"
  createdAt: string
  expiresAt?: string
  status: "pending" | "approved" | "rejected"
}

export type ExternalAccessGrant = {
  grantId: string
  requestId: string
  mountId: string
  runId: string
  workspaceId: string
  targetPath: string
  targetKind: WorkspaceTargetKind
  accessMode: WorkspaceAccessMode
  backendType: string
  rootPath: string
  rootLabel: string
  scope: "external" | "sensitive" | "external-sensitive"
  allowSensitive: boolean
  createdAt: string
  expiresAt?: string
}

export type WorkspaceAccessAllowed = {
  kind: "allowed"
  backend: WorkspaceBackend
  handle: WorkspaceHandle
  relativePath: string
  absolutePath: string
  logicalPath: string
  scope: "workspace" | "grant"
  targetKind: WorkspaceTargetKind
  grant?: ExternalAccessGrant
}

export type WorkspaceAccessApprovalRequired = {
  kind: "approval_required"
  request: ExternalAccessRequest
  requestCreated: boolean
}

export type WorkspaceAccessNotFound = {
  kind: "not_found"
  path: string
  message: string
}

export type WorkspaceAccessDenied = {
  kind: "denied"
  code: WorkspaceErrorCode
  message: string
  details?: unknown
}

export type WorkspaceAccessResolution =
  | WorkspaceAccessAllowed
  | WorkspaceAccessApprovalRequired
  | WorkspaceAccessNotFound
  | WorkspaceAccessDenied

export type WorkspaceBackend = {
  type: string
  capabilities(): WorkspaceBackendCapabilities
  resolve(path: string): Promise<string>
  readFile(path: string): Promise<WorkspaceReadFileResult>
  listFiles(path: string): Promise<WorkspaceListEntry[]>
  glob(pattern: string, cwd?: string): Promise<string[]>
  grep(pattern: string, path: string): Promise<WorkspaceGrepMatch[]>
  writeFile?(path: string, content: string, options?: { overwrite?: boolean }): Promise<WorkspaceWriteFileResult>
  editFile?(path: string, patch: WorkspaceEditFilePatch): Promise<WorkspaceEditFileResult>
  createSnapshot?(): Promise<{ snapshotId: string }>
  restoreSnapshot?(snapshotId: string): Promise<void>
}
