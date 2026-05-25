import { z } from "zod"
import { createRunEvent } from "../run-events"
import { WorkspaceError } from "../workspace"
import type {
  WorkspaceAccessMode,
  WorkspaceAccessResolution,
  WorkspaceEditFileResult,
  WorkspaceGrepMatch,
  WorkspaceListEntry,
  WorkspaceWriteFileResult,
} from "../workspace"
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "./types"

const lsInputSchema = z.object({
  path: z.string().optional().default("."),
})

const readFileInputSchema = z.object({
  path: z.string().min(1),
})

const globInputSchema = z.object({
  path: z.string().optional().default("."),
  pattern: z.string().min(1),
})

const grepInputSchema = z.object({
  path: z.string().min(1),
  pattern: z.string().min(1),
  maxResults: z.number().int().positive().max(200).optional(),
})

const writeFileInputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  overwrite: z.boolean().optional().default(false),
})

const editFileInputSchema = z.object({
  path: z.string().min(1),
  search: z.string().min(1),
  replace: z.string(),
  expectedReplacements: z.number().int().positive().max(1000).optional(),
})

type WorkspaceToolInput = {
  path: string
}

type WorkspaceServiceLike = NonNullable<ToolExecutionContext["workspaceService"]>

function normalizePath(pathValue: string): string {
  const trimmed = pathValue.trim()
  if (trimmed.length === 0) {
    return "."
  }

  return trimmed.replaceAll("\\", "/")
}

function joinPattern(basePath: string, pattern: string): string {
  const normalizedBase = normalizePath(basePath)
  const normalizedPattern = normalizePath(pattern)

  if (normalizedBase === ".") {
    return normalizedPattern
  }

  return `${normalizedBase.replace(/\/+$/, "")}/${normalizedPattern.replace(/^\/+/, "")}`
}

function createUnsupportedResult<TData = unknown>(toolName: string): ToolExecutionResult<TData> {
  return {
    status: "failed",
    summary: `${toolName} is unavailable because this run has no bound workspace`,
    error: {
      code: "WORKSPACE_NOT_BOUND",
      message: `A bound workspace is required for ${toolName}`,
    },
  }
}

function createNotFoundResult<TData = unknown>(message: string): ToolExecutionResult<TData> {
  return {
    status: "failed",
    summary: message,
    error: {
      code: "WORKSPACE_PATH_NOT_FOUND",
      message,
    },
  }
}

function createDeniedResult<TData = unknown>(
  code: string,
  message: string,
  details?: unknown
): ToolExecutionResult<TData> {
  return {
    status: "failed",
    summary: message,
    error: {
      code,
      message,
      details,
    },
  }
}

function createApprovalFailureResult<TData = unknown>(
  toolName: string,
  request: {
    requestId: string
    logicalPath: string
    targetKind: string
    accessMode: string
    reason: string
    riskLevel: string
    workspaceId: string
  }
): ToolExecutionResult<TData> {
  return {
    status: "failed",
    summary: `${toolName} requires approval for ${request.logicalPath}`,
    data: {
      requestId: request.requestId,
      logicalPath: request.logicalPath,
      targetKind: request.targetKind,
      accessMode: request.accessMode,
      reason: request.reason,
      riskLevel: request.riskLevel,
      workspaceId: request.workspaceId,
    } as TData,
    error: {
      code: "WORKSPACE_EXTERNAL_ACCESS_PENDING_APPROVAL",
      message: `Access to ${request.logicalPath} requires approval`,
      details: {
        requestId: request.requestId,
        logicalPath: request.logicalPath,
        targetKind: request.targetKind,
        accessMode: request.accessMode,
        riskLevel: request.riskLevel,
        workspaceId: request.workspaceId,
      },
    },
    runtime: {
      request,
    },
  }
}

async function resolveAccess(
  context: ToolExecutionContext,
  toolName: string,
  path: string,
  reason: string,
  accessMode: WorkspaceAccessMode,
  options: {
    targetKind?: "file" | "directory"
    allowMissingTarget?: boolean
  } = {}
): Promise<WorkspaceAccessResolution | { kind: "unavailable" }> {
  const workspaceService = context.workspaceService
  if (!workspaceService) {
    return { kind: "unavailable" }
  }

  return workspaceService.resolveAccess({
    runId: context.runId,
    agentId: context.agent.id,
    path: normalizePath(path),
    accessMode,
    reason,
    toolName,
    targetKind: options.targetKind,
    allowMissingTarget: options.allowMissingTarget,
  })
}

async function prepareApproval(
  context: ToolExecutionContext,
  toolName: string,
  path: string,
  reason: string,
  accessMode: WorkspaceAccessMode,
  options: {
    targetKind?: "file" | "directory"
    allowMissingTarget?: boolean
  } = {}
): Promise<import("./types").ToolApprovalDraft | null> {
  const decision = await resolveAccess(context, toolName, path, reason, accessMode, options)
  if (decision.kind !== "approval_required") {
    return null
  }

  return {
    reason: decision.request.reason,
    riskLevel: decision.request.riskLevel,
    workspaceRequestId: decision.request.requestId,
    data: {
      workspaceId: decision.request.workspaceId,
      logicalPath: decision.request.logicalPath,
      targetKind: decision.request.targetKind,
      accessMode: decision.request.accessMode,
      approvalReason: decision.request.approvalReason,
    },
  }
}

async function runWithAccess<TData>(
  toolName: string,
  context: ToolExecutionContext,
  path: string,
  reason: string,
  accessMode: WorkspaceAccessMode,
  options: {
    targetKind?: "file" | "directory"
    allowMissingTarget?: boolean
  },
  onAllowed: (decision: Extract<WorkspaceAccessResolution, { kind: "allowed" }>) => Promise<ToolExecutionResult<TData>>
): Promise<ToolExecutionResult<TData>> {
  const decision = await resolveAccess(context, toolName, path, reason, accessMode, options)

  if (decision.kind === "unavailable") {
    return createUnsupportedResult(toolName)
  }

  if (decision.kind === "approval_required") {
    return createApprovalFailureResult(toolName, decision.request)
  }

  if (decision.kind === "not_found") {
    return createNotFoundResult(decision.message)
  }

  if (decision.kind === "denied") {
    return createDeniedResult(decision.code, decision.message, decision.details)
  }

  try {
    return await onAllowed(decision)
  } catch (error) {
    if (error instanceof WorkspaceError) {
      return createDeniedResult(error.code, error.message, error.details)
    }
    throw error
  }
}

function formatListResult(entries: WorkspaceListEntry[], path: string): ToolExecutionResult<{ entries: WorkspaceListEntry[] }> {
  return {
    status: "completed",
    summary: `Listed ${entries.length} entr${entries.length === 1 ? "y" : "ies"} under ${path}`,
    data: {
      entries,
    },
  }
}

function formatReadResult(result: {
  path: string
  mimeType: string
  size: number
  blocks: unknown[]
}): ToolExecutionResult<{
  path: string
  mimeType: string
  size: number
  blocks: unknown[]
}> {
  return {
    status: "completed",
    summary: `Read ${result.path}`,
    data: result,
  }
}

function formatGlobResult(matches: string[], pattern: string): ToolExecutionResult<{ matches: string[] }> {
  return {
    status: "completed",
    summary: `Found ${matches.length} match${matches.length === 1 ? "" : "es"} for ${pattern}`,
    data: {
      matches,
    },
  }
}

function formatGrepResult(matches: WorkspaceGrepMatch[], pattern: string): ToolExecutionResult<{ matches: WorkspaceGrepMatch[] }> {
  return {
    status: "completed",
    summary: `Found ${matches.length} line match${matches.length === 1 ? "" : "es"} for ${pattern}`,
    data: {
      matches,
    },
  }
}

function formatWriteResult(result: WorkspaceWriteFileResult): ToolExecutionResult<WorkspaceWriteFileResult> {
  return {
    status: "completed",
    summary: `${result.created ? "Created" : "Wrote"} ${result.path}`,
    data: result,
  }
}

function formatEditResult(result: WorkspaceEditFileResult): ToolExecutionResult<WorkspaceEditFileResult> {
  return {
    status: "completed",
    summary: `Edited ${result.path} with ${result.replacements} replacement${result.replacements === 1 ? "" : "s"}`,
    data: result,
  }
}

function createWorkspaceTool<TInput, TData>(
  name: string,
  displayName: string,
  description: string,
  inputSchema: z.ZodType<TInput>,
  riskLevel: "low" | "medium" | "high",
  accessMode: WorkspaceAccessMode,
  accessOptions: {
    targetKind?: "file" | "directory"
    allowMissingTarget?: boolean
  },
  pathSelector: (input: TInput) => string,
  approvalReason: string,
  executor: (
    input: TInput,
    context: ToolExecutionContext,
    decision: Extract<WorkspaceAccessResolution, { kind: "allowed" }>
  ) => Promise<ToolExecutionResult<TData>>
): ToolDefinition<TInput, TData> {
  return {
    name,
    displayName,
    description,
    category: "workspace",
    inputSchema,
    riskLevel,
    requiredPermissions: {
      filesystem: accessMode === "read" ? "read" : "write",
    },
    approvalPolicy: "contextual",
    configurableByUserAgent: true,
    prepareApproval: async (input, context) => {
      const path = pathSelector(input)
      return prepareApproval(context, name, path, approvalReason, accessMode, accessOptions)
    },
    async execute(input, context) {
      const path = pathSelector(input)
      return runWithAccess(name, context, path, approvalReason, accessMode, accessOptions, async (decision) => executor(input, context, decision))
    },
  }
}

export function createWorkspaceReadOnlyTools(): Array<ToolDefinition<any, any>> {
  return [
    createWorkspaceTool(
      "ls",
      "List files",
      "List files and directories in a workspace path.",
      lsInputSchema,
      "low",
      "read",
      {},
      (input: WorkspaceToolInput) => input.path,
      "List workspace contents",
      async (_input, _context, decision) => {
        const entries = await decision.backend.listFiles(decision.relativePath)
        return formatListResult(entries, decision.logicalPath)
      }
    ),
    createWorkspaceTool(
      "read_file",
      "Read file",
      "Read a text file or image file from a workspace path.",
      readFileInputSchema,
      "low",
      "read",
      {
        targetKind: "file",
      },
      (input: { path: string }) => input.path,
      "Read file content",
      async (_input, _context, decision) => {
        const fileResult = await decision.backend.readFile(decision.relativePath)
        return formatReadResult(fileResult)
      }
    ),
    createWorkspaceTool(
      "glob",
      "Glob",
      "Find files and directories by glob pattern.",
      globInputSchema,
      "low",
      "read",
      {},
      (input: { path: string; pattern: string }) => input.path,
      "Search workspace paths with glob",
      async (input, _context, decision) => {
        const scopedPattern = joinPattern(decision.relativePath, input.pattern)
        const matches = await decision.backend.glob(scopedPattern)
        return formatGlobResult(matches, scopedPattern)
      }
    ),
    createWorkspaceTool(
      "grep",
      "Grep",
      "Search for text across files and directories in a workspace path.",
      grepInputSchema,
      "low",
      "read",
      {},
      (input: { path: string; pattern: string; maxResults?: number }) => input.path,
      "Search text with grep",
      async (input, _context, decision) => {
        const matches = await decision.backend.grep(input.pattern, decision.relativePath)
        return formatGrepResult(matches.slice(0, input.maxResults ?? 50), input.pattern)
      }
    ),
  ]
}

export function createWorkspaceWriteTools(): Array<ToolDefinition<any, any>> {
  return [
    createWorkspaceTool(
      "write_file",
      "Write file",
      "Create or overwrite a UTF-8 text file in the workspace.",
      writeFileInputSchema,
      "medium",
      "write",
      {
        targetKind: "file",
        allowMissingTarget: true,
      },
      (input: { path: string }) => input.path,
      "Write file content",
      async (input, _context, decision) => {
        if (!decision.backend.writeFile) {
          return createDeniedResult(
            "WORKSPACE_UNSUPPORTED_OPERATION",
            "The current workspace backend does not support write_file"
          )
        }
        const result = await decision.backend.writeFile(decision.relativePath, input.content, {
          overwrite: input.overwrite,
        })
        return formatWriteResult(result)
      }
    ),
    createWorkspaceTool(
      "edit_file",
      "Edit file",
      "Apply a precise search/replace edit to a UTF-8 text file in the workspace.",
      editFileInputSchema,
      "medium",
      "write",
      {
        targetKind: "file",
      },
      (input: { path: string }) => input.path,
      "Edit file content",
      async (input, _context, decision) => {
        if (!decision.backend.editFile) {
          return createDeniedResult(
            "WORKSPACE_UNSUPPORTED_OPERATION",
            "The current workspace backend does not support edit_file"
          )
        }
        const result = await decision.backend.editFile(decision.relativePath, {
          search: input.search,
          replace: input.replace,
          expectedReplacements: input.expectedReplacements,
        })
        return formatEditResult(result)
      }
    ),
  ]
}

export function createWorkspaceTools(): Array<ToolDefinition<any, any>> {
  return [
    ...createWorkspaceReadOnlyTools(),
    ...createWorkspaceWriteTools(),
  ]
}
