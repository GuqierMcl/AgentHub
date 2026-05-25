import { basename, dirname, isAbsolute, relative, resolve } from "node:path"
import { realpathSync, statSync } from "node:fs"
import { stat } from "node:fs/promises"
import { createChildLogger } from "../../logger"
import { DEFAULT_SANDBOX_POLICY, isSensitiveWorkspacePath } from "./sandbox-policy"
import type {
  ExternalAccessGrant,
  ExternalAccessRequest,
  SandboxPolicy,
  WorkspaceAccessResolution,
  WorkspaceBackend,
  WorkspaceHandle,
  WorkspaceReadApprovalReason,
} from "./types"
import { WorkspaceError } from "./types"
import { LocalWorkspaceBackend } from "./local-workspace-backend"

const log = createChildLogger("workspace-service")

type WorkspaceServiceOptions = {
  workdir: string
  workspaceId?: string
  runId?: string
  sandboxPolicy?: Partial<SandboxPolicy>
}

type ExternalAccessRequestInput = {
  runId: string
  agentId: string
  path: string
  accessMode: "read" | "write"
  reason: string
  toolName: string
}

function normalizeComparisonPath(pathValue: string): string {
  const normalized = resolve(pathValue)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function isWithinPath(candidatePath: string, rootPath: string): boolean {
  const candidate = normalizeComparisonPath(candidatePath)
  const root = normalizeComparisonPath(rootPath)
  if (candidate === root) {
    return true
  }
  const relativePath = relative(root, candidate)
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath)
}

function normalizeLogicalPath(pathValue: string): string {
  return pathValue.replaceAll("\\", "/")
}

function isExplicitContentTool(toolName: string): boolean {
  return toolName === "read_file" || toolName === "grep"
}

export class WorkspaceService {
  private readonly workspaceId: string
  private readonly runId: string
  private readonly workdir: string
  private readonly policy: SandboxPolicy
  private readonly mainBackend: LocalWorkspaceBackend
  private readonly mainHandle: WorkspaceHandle
  private readonly requestsById = new Map<string, ExternalAccessRequest>()
  private readonly requestKeys = new Map<string, string>()
  private readonly grantsById = new Map<string, ExternalAccessGrant>()
  private readonly grantBackends = new Map<string, WorkspaceBackend>()
  private active = true

  constructor(options: WorkspaceServiceOptions) {
    const requestedRoot = resolve(options.workdir)
    if (!statSync(requestedRoot, { throwIfNoEntry: false })) {
      throw new WorkspaceError("WORKSPACE_PATH_NOT_FOUND", `Workspace root ${requestedRoot} does not exist`)
    }
    if (!statSync(requestedRoot).isDirectory()) {
      throw new WorkspaceError("WORKSPACE_NOT_A_DIRECTORY", `Workspace root ${requestedRoot} is not a directory`)
    }

    this.workdir = realpathSync(requestedRoot)
    this.workspaceId = options.workspaceId ?? "workspace_main"
    this.runId = options.runId ?? "run_workspace_session"
    this.policy = {
      ...DEFAULT_SANDBOX_POLICY,
      ...options.sandboxPolicy,
      blockedBasenames: options.sandboxPolicy?.blockedBasenames ?? DEFAULT_SANDBOX_POLICY.blockedBasenames,
      blockedExtensions: options.sandboxPolicy?.blockedExtensions ?? DEFAULT_SANDBOX_POLICY.blockedExtensions,
    }
    this.mainBackend = new LocalWorkspaceBackend(this.workdir, {
      sandboxPolicy: this.policy,
    })
    this.mainHandle = {
      workspaceId: this.workspaceId,
      backendType: this.mainBackend.type,
      rootLabel: basename(this.workdir) || this.workdir,
      rootPath: this.workdir,
    }
  }

  getHandle(): WorkspaceHandle {
    return { ...this.mainHandle }
  }

  getBackendCapabilities() {
    return this.mainBackend.capabilities()
  }

  close(): void {
    this.active = false
    this.requestsById.clear()
    this.requestKeys.clear()
    this.grantsById.clear()
    this.grantBackends.clear()
  }

  async resolveAccess(input: ExternalAccessRequestInput): Promise<WorkspaceAccessResolution> {
    if (!this.active || input.runId !== this.runId) {
      return {
        kind: "denied",
        code: "WORKSPACE_ACCESS_DENIED",
        message: "Workspace session is not active for this run",
      }
    }
    if (input.accessMode !== "read") {
      return {
        kind: "denied",
        code: "WORKSPACE_UNSUPPORTED_OPERATION",
        message: "Workspace write access is not implemented in this phase",
      }
    }

    const normalizedPath = this.normalizeInputPath(input.path)
    const requestedCandidate = this.toAbsoluteCandidate(normalizedPath)
    const candidatePath = this.canonicalPathIfPresent(requestedCandidate)
    const outsideWorkspace = !isWithinPath(candidatePath, this.workdir)
    const logicalPath = this.toLogicalPath(candidatePath, outsideWorkspace)
    const sensitive = isSensitiveWorkspacePath(candidatePath, this.policy)
    const explicitContent = isExplicitContentTool(input.toolName)
    const approvedGrant = this.findApprovedGrant(candidatePath, input.accessMode, sensitive)

    if (approvedGrant) {
      return this.buildAllowedGrantResolution(approvedGrant, candidatePath)
    }

    if (sensitive && !explicitContent) {
      return {
        kind: "denied",
        code: "WORKSPACE_SENSITIVE_PATH_BLOCKED",
        message: "Sensitive paths cannot be enumerated or recursively scanned",
      }
    }

    const inspected = await this.inspectCandidate(candidatePath)
    if (!inspected.exists) {
      return {
        kind: "not_found",
        path: logicalPath,
        message: `Path ${logicalPath} does not exist`,
      }
    }

    if (sensitive) {
      return this.requireApproval(input, candidatePath, inspected.kind!, outsideWorkspace
        ? "external_sensitive_read"
        : "sensitive_read")
    }

    if (outsideWorkspace) {
      return this.requireApproval(input, candidatePath, inspected.kind!, "external_read")
    }

    try {
      const resolvedPath = await this.mainBackend.resolve(normalizedPath)
      return {
        kind: "allowed",
        backend: this.mainBackend,
        handle: this.mainHandle,
        relativePath: this.toRelativePath(resolvedPath, this.workdir),
        absolutePath: resolvedPath,
        logicalPath: this.toRelativePath(resolvedPath, this.workdir),
        scope: "workspace",
        targetKind: inspected.kind!,
      }
    } catch (error) {
      if (error instanceof WorkspaceError) {
        return {
          kind: "denied",
          code: error.code,
          message: error.message,
        }
      }
      throw error
    }
  }

  approveExternalAccess(requestId: string): ExternalAccessGrant | null {
    return this.approveReadAccess(requestId)
  }

  approveReadAccess(requestId: string): ExternalAccessGrant | null {
    const request = this.requestsById.get(requestId)
    if (!this.active || !request || request.status !== "pending" || request.accessMode !== "read") {
      return null
    }
    if (request.expiresAt && Date.parse(request.expiresAt) <= Date.now()) {
      request.status = "rejected"
      return null
    }

    const grantId = `grant_${crypto.randomUUID()}`
    const mountId = `mount_${crypto.randomUUID()}`
    const sensitive = request.approvalReason !== "external_read"
    const scope = request.approvalReason === "external_read"
      ? "external"
      : request.outsideWorkspace
        ? "external-sensitive"
        : "sensitive"
    const targetKind = sensitive ? "file" : request.targetKind
    const rootPath = targetKind === "directory" ? request.targetPath : dirname(request.targetPath)
    const externalDisplayPrefix = request.outsideWorkspace ? `mounts/${mountId}` : this.logicalParent(request.logicalPath)
    const backend = new LocalWorkspaceBackend(rootPath, {
      fileOnlyPath: targetKind === "file" ? request.targetPath : undefined,
      displayPrefix: externalDisplayPrefix,
      sandboxPolicy: {
        ...this.policy,
        blockSensitivePaths: !sensitive,
        allowExternalAccess: false,
      },
    })

    const grant: ExternalAccessGrant = {
      grantId,
      requestId,
      mountId,
      runId: request.runId,
      workspaceId: request.workspaceId,
      targetPath: request.targetPath,
      targetKind,
      accessMode: "read",
      backendType: backend.type,
      rootPath,
      rootLabel: request.outsideWorkspace ? `mounts/${mountId}` : this.mainHandle.rootLabel,
      scope,
      allowSensitive: sensitive,
      createdAt: new Date().toISOString(),
      expiresAt: request.expiresAt,
    }

    request.status = "approved"
    this.grantsById.set(grantId, grant)
    this.grantBackends.set(grantId, backend)
    return grant
  }

  getExternalAccessRequest(requestId: string): ExternalAccessRequest | null {
    return this.requestsById.get(requestId) ?? null
  }

  listExternalAccessRequests(): ExternalAccessRequest[] {
    return Array.from(this.requestsById.values())
  }

  private requireApproval(
    input: ExternalAccessRequestInput,
    targetPath: string,
    targetKind: "file" | "directory",
    approvalReason: WorkspaceReadApprovalReason
  ): WorkspaceAccessResolution {
    if (approvalReason !== "external_read" && targetKind !== "file") {
      return {
        kind: "denied",
        code: "WORKSPACE_SENSITIVE_PATH_BLOCKED",
        message: "Sensitive directory traversal is not supported",
      }
    }
    const request = this.ensureAccessRequest(input, targetPath, targetKind, approvalReason)
    return {
      kind: "approval_required",
      request: request.request,
      requestCreated: request.created,
    }
  }

  private buildAllowedGrantResolution(grant: ExternalAccessGrant, candidatePath: string): WorkspaceAccessResolution {
    const backend = this.grantBackends.get(grant.grantId)
    if (!backend) {
      return {
        kind: "denied",
        code: "WORKSPACE_ACCESS_DENIED",
        message: "Approved workspace grant is unavailable",
      }
    }
    const relativePath = grant.targetKind === "file"
      ? "."
      : this.toRelativePath(candidatePath, grant.targetPath)
    const logicalPath = grant.scope === "sensitive"
      ? this.toRelativePath(candidatePath, this.workdir)
      : relativePath === "."
        ? `mounts/${grant.mountId}`
        : `mounts/${grant.mountId}/${relativePath}`
    return {
      kind: "allowed",
      backend,
      handle: {
        workspaceId: grant.workspaceId,
        backendType: backend.type,
        rootLabel: grant.rootLabel,
        rootPath: grant.rootPath,
      },
      relativePath,
      absolutePath: candidatePath,
      logicalPath,
      scope: "grant",
      targetKind: grant.targetKind,
      grant,
    }
  }

  private findApprovedGrant(
    candidatePath: string,
    accessMode: "read" | "write",
    sensitive: boolean
  ): ExternalAccessGrant | null {
    const now = Date.now()
    const grants = Array.from(this.grantsById.values())
      .filter((grant) => grant.runId === this.runId && grant.workspaceId === this.workspaceId)
      .filter((grant) => grant.accessMode === accessMode)
      .filter((grant) => !grant.expiresAt || Date.parse(grant.expiresAt) > now)
      .filter((grant) => !sensitive || grant.allowSensitive)
      .filter((grant) => grant.targetKind === "file"
        ? normalizeComparisonPath(grant.targetPath) === normalizeComparisonPath(candidatePath)
        : isWithinPath(candidatePath, grant.targetPath))

    return grants.sort((left, right) => right.targetPath.length - left.targetPath.length)[0] ?? null
  }

  private ensureAccessRequest(
    input: ExternalAccessRequestInput,
    targetPath: string,
    targetKind: "file" | "directory",
    approvalReason: WorkspaceReadApprovalReason
  ): { request: ExternalAccessRequest; created: boolean } {
    const key = [input.runId, input.agentId, targetPath, input.accessMode, input.toolName, approvalReason].join("|")
    const existingId = this.requestKeys.get(key)
    const existing = existingId ? this.requestsById.get(existingId) : undefined
    if (existing && existing.status === "pending") {
      return { request: existing, created: false }
    }

    const outsideWorkspace = !isWithinPath(targetPath, this.workdir)
    const logicalPath = this.toLogicalPath(targetPath, outsideWorkspace)
    const request: ExternalAccessRequest = {
      requestId: `request_${crypto.randomUUID()}`,
      runId: input.runId,
      workspaceId: this.workspaceId,
      targetPath,
      targetKind,
      accessMode: input.accessMode,
      reason: input.reason,
      approvalReason,
      logicalPath,
      outsideWorkspace,
      riskLevel: approvalReason === "external_read" ? "medium" : "high",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      status: "pending",
    }
    this.requestsById.set(request.requestId, request)
    this.requestKeys.set(key, request.requestId)
    log.info({
      requestId: request.requestId,
      runId: input.runId,
      workspaceId: this.workspaceId,
      agentId: input.agentId,
      toolName: input.toolName,
      approvalReason,
    }, "Workspace read approval requested")
    return { request, created: true }
  }

  private normalizeInputPath(pathValue: string): string {
    return !pathValue || pathValue.trim().length === 0 ? "." : normalizeLogicalPath(pathValue.trim())
  }

  private toAbsoluteCandidate(pathValue: string): string {
    return isAbsolute(pathValue) ? resolve(pathValue) : resolve(this.workdir, pathValue)
  }

  private canonicalPathIfPresent(pathValue: string): string {
    try {
      return realpathSync(pathValue)
    } catch {
      return pathValue
    }
  }

  private toRelativePath(pathValue: string, rootPath: string): string {
    const relativePath = relative(rootPath, pathValue)
    return !relativePath ? "." : normalizeLogicalPath(relativePath)
  }

  private toLogicalPath(pathValue: string, outsideWorkspace: boolean): string {
    return outsideWorkspace
      ? `external/${basename(pathValue)}`
      : this.toRelativePath(pathValue, this.workdir)
  }

  private logicalParent(logicalPath: string): string | undefined {
    const slash = logicalPath.lastIndexOf("/")
    return slash > 0 ? logicalPath.slice(0, slash) : undefined
  }

  private async inspectCandidate(pathValue: string): Promise<{ exists: boolean; kind?: "file" | "directory" }> {
    const result = await stat(pathValue).catch(() => null)
    if (!result) {
      return { exists: false }
    }
    return {
      exists: true,
      kind: result.isDirectory() ? "directory" : "file",
    }
  }
}
