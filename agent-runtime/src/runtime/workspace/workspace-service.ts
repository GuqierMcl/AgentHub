import { existsSync, mkdirSync } from "node:fs"
import { basename, dirname, isAbsolute, relative, resolve } from "node:path"
import { stat } from "node:fs/promises"
import { createChildLogger } from "../../logger"
import type {
  ExternalAccessGrant,
  ExternalAccessRequest,
  WorkspaceAccessAllowed,
  WorkspaceAccessDenied,
  WorkspaceAccessNotFound,
  WorkspaceAccessResolution,
  WorkspaceBackend,
  WorkspaceHandle,
} from "./types"
import { WorkspaceError } from "./types"
import { LocalWorkspaceBackend } from "./local-workspace-backend"

const log = createChildLogger("workspace-service")

type WorkspaceServiceOptions = {
  workdir: string
  workspaceId?: string
}

type ExternalAccessRequestInput = {
  runId: string
  agentId: string
  path: string
  accessMode: "read" | "write"
  reason: string
  toolName: string
  targetKind?: "file" | "directory"
}

type ResolvedPathContext = {
  backend: WorkspaceBackend
  handle: WorkspaceHandle
  absolutePath: string
  relativePath: string
  scope: "workspace" | "grant"
  grant?: ExternalAccessGrant
}

function normalizeComparisonPath(pathValue: string): string {
  const normalized = resolve(pathValue)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function isWithinPath(candidatePath: string, rootPath: string): boolean {
  const normalizedCandidate = normalizeComparisonPath(candidatePath)
  const normalizedRoot = normalizeComparisonPath(rootPath)

  if (normalizedCandidate === normalizedRoot) {
    return true
  }

  const relativePath = relative(normalizedRoot, normalizedCandidate)
  return relativePath !== "" && !relativePath.startsWith("..")
}

function buildRequestKey(input: ExternalAccessRequestInput): string {
  return [
    input.runId,
    input.agentId,
    input.path,
    input.accessMode,
    input.toolName,
  ].join("|")
}

export class WorkspaceService {
  private workspaceId: string
  private workdir: string
  private mainBackend: LocalWorkspaceBackend
  private mainHandle: WorkspaceHandle
  private requestsById = new Map<string, ExternalAccessRequest>()
  private requestKeys = new Map<string, string>()
  private grantsById = new Map<string, ExternalAccessGrant>()
  private grantBackends = new Map<string, WorkspaceBackend>()

  constructor(options: WorkspaceServiceOptions) {
    this.workdir = resolve(options.workdir)
    this.workspaceId = options.workspaceId ?? "workspace_main"

    if (!existsSync(this.workdir)) {
      mkdirSync(this.workdir, { recursive: true })
    }

    this.mainBackend = new LocalWorkspaceBackend(this.workdir, {
      sandboxPolicy: {
        readOnly: true,
        blockSensitivePaths: true,
        allowExternalAccess: true,
      },
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

  async resolveAccess(input: ExternalAccessRequestInput): Promise<WorkspaceAccessResolution> {
    const normalizedPath = this.normalizeInputPath(input.path)
    const candidatePath = this.toAbsoluteCandidate(normalizedPath)

    const approvedGrant = this.findApprovedGrant(candidatePath, input.accessMode)
    if (approvedGrant) {
      const context = this.buildGrantContext(approvedGrant, candidatePath)
      if (context) {
        return {
          kind: "allowed",
          backend: context.backend,
          handle: context.handle,
          relativePath: context.relativePath,
          absolutePath: context.absolutePath,
          scope: context.scope,
          targetKind: approvedGrant.targetKind,
          grant: approvedGrant,
        }
      }

      return {
        kind: "denied",
        code: "WORKSPACE_ACCESS_DENIED",
        message: `Approved grant for ${input.path} could not be resolved`,
      }
    }

    try {
      const resolvedPath = await this.mainBackend.resolve(normalizedPath)
      const resolvedStat = await stat(resolvedPath).catch(() => null)

      if (!resolvedStat) {
        return {
          kind: "not_found",
          path: input.path,
          message: `Path ${input.path} does not exist`,
        }
      }

      return {
        kind: "allowed",
        backend: this.mainBackend,
        handle: this.mainHandle,
        relativePath: this.toRelativePath(resolvedPath, this.workdir),
        absolutePath: resolvedPath,
        scope: "workspace",
        targetKind: resolvedStat.isDirectory() ? "directory" : "file",
      }
    } catch (error) {
      if (error instanceof WorkspaceError) {
        if (error.code === "WORKSPACE_PATH_NOT_FOUND") {
          return {
            kind: "not_found",
            path: input.path,
            message: `Path ${input.path} does not exist`,
          }
        }

        if (error.code === "WORKSPACE_PATH_OUTSIDE_ROOT") {
          const candidateStat = await this.inspectCandidate(candidatePath)
          if (!candidateStat.exists) {
            return {
              kind: "not_found",
              path: input.path,
              message: `Path ${input.path} does not exist`,
            }
          }

          const externalAccess = this.ensureExternalAccessRequest({
            ...input,
            path: candidatePath,
            targetKind: candidateStat.kind,
          })

          return {
            kind: "approval_required",
            request: externalAccess.request,
            requestCreated: externalAccess.created,
          }
        }

        return {
          kind: "denied",
          code: error.code,
          message: error.message,
          details: error.details,
        }
      }

      throw error
    }
  }

  approveExternalAccess(requestId: string): ExternalAccessGrant | null {
    const request = this.requestsById.get(requestId)
    if (!request || request.status !== "pending" || request.accessMode !== "read") {
      return null
    }

    const grantId = `grant_${crypto.randomUUID()}`
    const mountId = `mount_${crypto.randomUUID()}`
    const targetPath = request.targetPath
    const targetKind = request.targetKind
    const rootPath = targetKind === "directory" ? targetPath : dirname(targetPath)
    const rootLabel = basename(targetPath)

    const backend = new LocalWorkspaceBackend(rootPath, {
      fileOnlyPath: targetKind === "file" ? targetPath : undefined,
      sandboxPolicy: {
        readOnly: true,
        blockSensitivePaths: false,
        allowExternalAccess: false,
        blockedBasenames: [],
        blockedExtensions: [],
      },
    })

    const grant: ExternalAccessGrant = {
      grantId,
      requestId,
      mountId,
      workspaceId: request.workspaceId,
      targetPath,
      targetKind,
      accessMode: request.accessMode,
      backendType: backend.type,
      rootPath,
      rootLabel,
      createdAt: new Date().toISOString(),
      expiresAt: request.expiresAt,
    }

    request.status = "approved"
    this.requestsById.set(requestId, request)
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

  private normalizeInputPath(pathValue: string): string {
    if (!pathValue || pathValue.trim().length === 0) {
      return "."
    }

    return pathValue.trim().replaceAll("\\", "/")
  }

  private toAbsoluteCandidate(pathValue: string): string {
    return isAbsolute(pathValue) ? resolve(pathValue) : resolve(this.workdir, pathValue)
  }

  private toRelativePath(pathValue: string, rootPath: string): string {
    const relativePath = relative(rootPath, pathValue)
    if (!relativePath || relativePath === "") {
      return "."
    }

    return relativePath.replaceAll("\\", "/")
  }

  private findApprovedGrant(
    candidatePath: string,
    accessMode: "read" | "write"
  ): ExternalAccessGrant | null {
    const grants = Array.from(this.grantsById.values())
      .filter((grant) => grant.accessMode === accessMode)
      .filter((grant) => {
        if (grant.targetKind === "file") {
          return normalizeComparisonPath(grant.targetPath) === normalizeComparisonPath(candidatePath)
        }

        return isWithinPath(candidatePath, grant.targetPath)
      })

    if (grants.length === 0) {
      return null
    }

    return grants.sort((left, right) => right.targetPath.length - left.targetPath.length)[0] ?? null
  }

  private buildGrantContext(grant: ExternalAccessGrant, candidatePath: string): ResolvedPathContext | null {
    const backend = this.grantBackends.get(grant.grantId)
    if (!backend) {
      return null
    }

    if (grant.targetKind === "file") {
      return {
        backend,
        handle: {
          workspaceId: grant.workspaceId,
          backendType: backend.type,
          rootLabel: grant.rootLabel,
          rootPath: grant.rootPath,
        },
        absolutePath: grant.targetPath,
        relativePath: ".",
        scope: "grant",
        grant,
      }
    }

    return {
      backend,
      handle: {
        workspaceId: grant.workspaceId,
        backendType: backend.type,
        rootLabel: grant.rootLabel,
        rootPath: grant.rootPath,
      },
      absolutePath: candidatePath,
      relativePath: this.toRelativePath(candidatePath, grant.targetPath),
      scope: "grant",
      grant,
    }
  }

  private ensureExternalAccessRequest(input: ExternalAccessRequestInput): {
    request: ExternalAccessRequest
    created: boolean
  } {
    const requestKey = buildRequestKey(input)
    const existingRequestId = this.requestKeys.get(requestKey)
    if (existingRequestId) {
      const existingRequest = this.requestsById.get(existingRequestId)
      if (existingRequest) {
        return {
          request: existingRequest,
          created: false,
        }
      }
    }

    const requestId = `request_${crypto.randomUUID()}`
    const request: ExternalAccessRequest = {
      requestId,
      runId: input.runId,
      workspaceId: this.workspaceId,
      targetPath: input.path,
      targetKind: input.targetKind ?? this.detectTargetKind(input.path),
      accessMode: input.accessMode,
      reason: input.reason,
      riskLevel: this.inferRiskLevel(input.path, input.accessMode),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      status: "pending",
    }

    this.requestsById.set(requestId, request)
    this.requestKeys.set(requestKey, requestId)

    log.info(
      {
        requestId,
        runId: input.runId,
        agentId: input.agentId,
        toolName: input.toolName,
        targetPath: input.path,
        accessMode: input.accessMode,
      },
      "External workspace access request created"
    )

    return {
      request,
      created: true,
    }
  }

  private detectTargetKind(pathValue: string): "file" | "directory" {
    if (pathValue.endsWith("/") || pathValue.endsWith("\\")) {
      return "directory"
    }

    const extension = pathValue.includes(".") ? pathValue.split(".").pop() ?? "" : ""
    if (extension.length > 0 && !pathValue.endsWith(".")) {
      return "file"
    }

    return "file"
  }

  private inferRiskLevel(pathValue: string, accessMode: "read" | "write"): "low" | "medium" | "high" {
    if (accessMode === "write") {
      return "high"
    }

    if (basename(pathValue).startsWith(".")) {
      return "high"
    }

    return "medium"
  }

  private async inspectCandidate(pathValue: string): Promise<{
    exists: boolean
    kind?: "file" | "directory"
  }> {
    try {
      const candidateStat = await stat(pathValue)
      return {
        exists: true,
        kind: candidateStat.isDirectory() ? "directory" : "file",
      }
    } catch {
      return { exists: false }
    }
  }
}
