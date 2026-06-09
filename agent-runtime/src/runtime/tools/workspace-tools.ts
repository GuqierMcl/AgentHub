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
    summary: `${toolName} 不可用，因为此运行没有绑定工作区`,
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
    summary: `${toolName} 需要审批才能访问 ${request.logicalPath}`,
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
    summary: `列出 ${path} 下的 ${entries.length} 个条目`,
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
    summary: `读取 ${result.path}`,
    data: result,
  }
}

function formatGlobResult(matches: string[], pattern: string): ToolExecutionResult<{ matches: string[] }> {
  return {
    status: "completed",
    summary: `在 ${pattern} 中找到 ${matches.length} 个匹配`,
    data: {
      matches,
    },
  }
}

function formatGrepResult(matches: WorkspaceGrepMatch[], pattern: string): ToolExecutionResult<{ matches: WorkspaceGrepMatch[] }> {
  return {
    status: "completed",
    summary: `在 ${pattern} 中找到 ${matches.length} 行匹配`,
    data: {
      matches,
    },
  }
}

function formatWriteResult(result: WorkspaceWriteFileResult): ToolExecutionResult<WorkspaceWriteFileResult> {
  return {
    status: "completed",
    summary: `${result.created ? "创建" : "写入"} ${result.path}`,
    data: result,
  }
}

function formatEditResult(result: WorkspaceEditFileResult): ToolExecutionResult<WorkspaceEditFileResult> {
  return {
    status: "completed",
    summary: `编辑 ${result.path}，替换了 ${result.replacements} 处`,
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
      "列出工作区路径中的文件和目录。",
      lsInputSchema,
      "low",
      "read",
      {},
      (input: WorkspaceToolInput) => input.path,
      "列出工作区内容",
      async (_input, _context, decision) => {
        const entries = await decision.backend.listFiles(decision.relativePath)
        return formatListResult(entries, decision.logicalPath)
      }
    ),
    createWorkspaceTool(
      "read_file",
      "Read file",
      "从工作区路径读取文本文件或图片文件。",
      readFileInputSchema,
      "low",
      "read",
      {
        targetKind: "file",
      },
      (input: { path: string }) => input.path,
      "读取文件内容",
      async (_input, _context, decision) => {
        const fileResult = await decision.backend.readFile(decision.relativePath)
        return formatReadResult(fileResult)
      }
    ),
    createWorkspaceTool(
      "glob",
      "Glob",
      "通过 glob 模式查找工作区中的文件和目录。",
      globInputSchema,
      "low",
      "read",
      {},
      (input: { path: string; pattern: string }) => input.path,
      "通过 glob 搜索工作区路径",
      async (input, _context, decision) => {
        const scopedPattern = joinPattern(decision.relativePath, input.pattern)
        const matches = await decision.backend.glob(scopedPattern)
        return formatGlobResult(matches, scopedPattern)
      }
    ),
    createWorkspaceTool(
      "grep",
      "Grep",
      "在工作区路径的文件和目录中搜索文本。",
      grepInputSchema,
      "low",
      "read",
      {},
      (input: { path: string; pattern: string; maxResults?: number }) => input.path,
      "通过 grep 搜索文本",
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
      "在工作区中创建或覆盖 UTF-8 文本文件。",
      writeFileInputSchema,
      "medium",
      "write",
      {
        targetKind: "file",
        allowMissingTarget: true,
      },
      (input: { path: string }) => input.path,
      "写入文件内容",
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
      "对工作区中的 UTF-8 文本文件应用精确的查找/替换编辑。",
      editFileInputSchema,
      "medium",
      "write",
      {
        targetKind: "file",
      },
      (input: { path: string }) => input.path,
      "编辑文件内容",
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
