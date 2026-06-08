import { existsSync, statSync } from "node:fs"
import { readFile as readFileFromFs, readdir, stat, realpath, writeFile as writeFileToFs } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path"
import type {
  SandboxPolicy,
  WorkspaceBackend,
  WorkspaceBackendCapabilities,
  WorkspaceContentBlock,
  WorkspaceEditFilePatch,
  WorkspaceEditFileResult,
  WorkspaceGrepMatch,
  WorkspaceListEntry,
  WorkspaceReadFileResult,
  WorkspaceWriteFileResult,
} from "./types"
import { WorkspaceError } from "./types"
import { DEFAULT_SANDBOX_POLICY, isSensitiveWorkspacePath } from "./sandbox-policy"

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".css",
  ".html",
  ".htm",
  ".xml",
  ".svg",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".sh",
  ".zsh",
  ".bash",
])

const EDIT_FILE_DIFF_CONTEXT_LINES = 3
const EDIT_FILE_DIFF_MAX_CHARS = 32_000
const EDIT_FILE_DIFF_MAX_LCS_CELLS = 200_000

export type LocalWorkspaceBackendOptions = {
  fileOnlyPath?: string
  displayPrefix?: string
  sandboxPolicy?: Partial<SandboxPolicy>
}

function normalizeForComparison(pathValue: string): string {
  const normalized = normalize(pathValue)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function normalizeForDisplay(pathValue: string): string {
  return pathValue.replaceAll("\\", "/")
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const candidate = normalizeForComparison(candidatePath)
  const root = normalizeForComparison(rootPath)

  if (candidate === root) {
    return true
  }

  const relativePath = relative(root, candidate)
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath)
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/")
}

function isTextMimeType(mimeType: string, pathValue: string): boolean {
  if (mimeType.startsWith("text/")) {
    return true
  }

  const extension = extname(pathValue).toLowerCase()
  const fileName = basename(pathValue).toLowerCase()
  return TEXT_EXTENSIONS.has(extension) ||
    fileName === ".env" ||
    fileName.startsWith(".env.") ||
    fileName === ".npmrc"
}

function buildTextBlock(text: string): WorkspaceContentBlock[] {
  return [{ type: "text", text }]
}

async function readImageContent(pathValue: string, mimeType: string): Promise<WorkspaceContentBlock[]> {
  const data = Buffer.from(await Bun.file(pathValue).arrayBuffer()).toString("base64")
  return [{ type: "image", mimeType, data, encoding: "base64" }]
}

async function resolveRealPathIfExists(pathValue: string): Promise<string | null> {
  try {
    return await realpath(pathValue)
  } catch {
    return null
  }
}

async function walkDirectory(
  directoryPath: string,
  visitor: (entryPath: string, kind: "file" | "dir") => Promise<void> | void
): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue
    }

    const entryPath = join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      await visitor(entryPath, "dir")
      await walkDirectory(entryPath, visitor)
      continue
    }

    if (entry.isFile()) {
      await visitor(entryPath, "file")
    }
  }
}

export class LocalWorkspaceBackend implements WorkspaceBackend {
  type = "local"
  private rootPath: string
  private fileOnlyPath?: string
  private displayPrefix?: string
  private policy: SandboxPolicy

  constructor(rootPath: string, options: LocalWorkspaceBackendOptions = {}) {
    this.rootPath = resolve(rootPath)
    this.fileOnlyPath = options.fileOnlyPath ? resolve(options.fileOnlyPath) : undefined
    this.displayPrefix = options.displayPrefix
    this.policy = {
      readOnly: options.sandboxPolicy?.readOnly ?? DEFAULT_SANDBOX_POLICY.readOnly,
      blockSensitivePaths: options.sandboxPolicy?.blockSensitivePaths ?? DEFAULT_SANDBOX_POLICY.blockSensitivePaths,
      allowExternalAccess: options.sandboxPolicy?.allowExternalAccess ?? false,
      blockedBasenames: options.sandboxPolicy?.blockedBasenames ?? DEFAULT_SANDBOX_POLICY.blockedBasenames,
      blockedExtensions: options.sandboxPolicy?.blockedExtensions ?? DEFAULT_SANDBOX_POLICY.blockedExtensions,
    }

    if (!existsSync(this.rootPath)) {
      throw new WorkspaceError("WORKSPACE_PATH_NOT_FOUND", `Workspace root ${this.rootPath} does not exist`)
    }
    if (!statSync(this.rootPath).isDirectory()) {
      throw new WorkspaceError("WORKSPACE_NOT_A_DIRECTORY", `Workspace root ${this.rootPath} is not a directory`)
    }
  }

  capabilities(): WorkspaceBackendCapabilities {
    return {
      read: true,
      write: true,
      edit: true,
      list: true,
      glob: true,
      grep: true,
      imageRead: true,
      snapshots: false,
      externalMounts: true,
    }
  }

  async resolve(path: string): Promise<string> {
    const normalizedInput = this.normalizeInputPath(path)

    if (this.fileOnlyPath) {
      return this.resolveSingleFilePath(normalizedInput)
    }

    return this.resolveDirectoryPath(normalizedInput)
  }

  async readFile(path: string): Promise<WorkspaceReadFileResult> {
    const resolvedPath = await this.resolve(path)
    const fileStat = await stat(resolvedPath).catch(() => null)

    if (!fileStat || !fileStat.isFile()) {
      throw new WorkspaceError(
        "WORKSPACE_NOT_A_FILE",
        `Path ${normalizeForDisplay(path)} is not a file`,
        { path, resolvedPath }
      )
    }

    const mimeType = Bun.file(resolvedPath).type || "application/octet-stream"
    if (isImageMimeType(mimeType)) {
      return {
        path: this.toDisplayPath(resolvedPath),
        mimeType,
        size: fileStat.size,
        blocks: await readImageContent(resolvedPath, mimeType),
      }
    }

    if (!isTextMimeType(mimeType, resolvedPath)) {
      throw new WorkspaceError(
        "WORKSPACE_BINARY_FILE_UNSUPPORTED",
        `Binary file ${normalizeForDisplay(path)} is not supported by read_file`,
        { path, resolvedPath, mimeType }
      )
    }

    const content = await readFileFromFs(resolvedPath, "utf-8")
    return {
      path: this.toDisplayPath(resolvedPath),
      mimeType,
      size: fileStat.size,
      blocks: buildTextBlock(content),
    }
  }

  async listFiles(path: string): Promise<WorkspaceListEntry[]> {
    const resolvedPath = await this.resolve(path)
    const fileStat = await stat(resolvedPath).catch(() => null)

    if (!fileStat) {
      throw new WorkspaceError(
        "WORKSPACE_PATH_NOT_FOUND",
        `Path ${normalizeForDisplay(path)} was not found`,
        { path, resolvedPath }
      )
    }

    if (fileStat.isFile()) {
      const mimeType = Bun.file(resolvedPath).type || "application/octet-stream"
      return [{
        path: this.toDisplayPath(resolvedPath),
        kind: "file",
        size: fileStat.size,
        mimeType,
      }]
    }

    if (!fileStat.isDirectory()) {
      throw new WorkspaceError(
        "WORKSPACE_NOT_A_DIRECTORY",
        `Path ${normalizeForDisplay(path)} is not a directory`,
        { path, resolvedPath }
      )
    }

    const entries: WorkspaceListEntry[] = []
    const directoryEntries = await readdir(resolvedPath, { withFileTypes: true })

    for (const entry of directoryEntries) {
      if (entry.isSymbolicLink()) {
        continue
      }

      const entryPath = join(resolvedPath, entry.name)
      const displayPath = this.toDisplayPath(entryPath)

      if (this.policy.blockSensitivePaths && isSensitiveWorkspacePath(displayPath, this.policy)) {
        continue
      }

      const entryStat = await stat(entryPath).catch(() => null)
      if (!entryStat) {
        continue
      }

      if (entryStat.isDirectory()) {
        entries.push({
          path: displayPath,
          kind: "dir",
        })
        continue
      }

      if (entryStat.isFile()) {
        entries.push({
          path: displayPath,
          kind: "file",
          size: entryStat.size,
          mimeType: Bun.file(entryPath).type || "application/octet-stream",
        })
      }
    }

    return entries
  }

  async glob(pattern: string, cwd = "."): Promise<string[]> {
    const searchRoot = await this.resolve(cwd)
    const rootStat = await stat(searchRoot).catch(() => null)

    if (!rootStat) {
      throw new WorkspaceError(
        "WORKSPACE_PATH_NOT_FOUND",
        `Path ${normalizeForDisplay(cwd)} was not found`,
        { path: cwd, resolvedPath: searchRoot }
      )
    }

    if (!rootStat.isDirectory()) {
      if (rootStat.isFile()) {
        const relativeFile = basename(searchRoot)
        const glob = new Bun.Glob(normalizePattern(pattern))
        return glob.match(relativeFile) ? [relativeFile] : []
      }

      throw new WorkspaceError(
        "WORKSPACE_NOT_A_DIRECTORY",
        `Path ${normalizeForDisplay(cwd)} is not a directory`,
        { path: cwd, resolvedPath: searchRoot }
      )
    }

    const glob = new Bun.Glob(normalizePattern(pattern))
    const matches: string[] = []

    await walkDirectory(searchRoot, async (entryPath, kind) => {
      const relativePath = normalizeForDisplay(relative(this.rootPath, entryPath))
      if (this.policy.blockSensitivePaths && isSensitiveWorkspacePath(relativePath, this.policy)) {
        return
      }

      if (glob.match(relativePath)) {
        matches.push(this.toDisplayPath(entryPath))
      }

      if (kind === "dir") {
        const directoryRelativePath = `${relativePath}/`
        if (glob.match(directoryRelativePath)) {
          matches.push(this.toDisplayPath(entryPath))
        }
      }
    })

    return Array.from(new Set(matches)).sort()
  }

  async grep(pattern: string, path: string): Promise<WorkspaceGrepMatch[]> {
    const resolvedPath = await this.resolve(path)
    const fileStat = await stat(resolvedPath).catch(() => null)

    if (!fileStat) {
      throw new WorkspaceError(
        "WORKSPACE_PATH_NOT_FOUND",
        `Path ${normalizeForDisplay(path)} was not found`,
        { path, resolvedPath }
      )
    }

    const results: WorkspaceGrepMatch[] = []
    const matcher = pattern.toLowerCase()
    const maxResults = 50

    const searchFile = async (filePath: string): Promise<void> => {
      const mimeType = Bun.file(filePath).type || "application/octet-stream"
      if (!isTextMimeType(mimeType, filePath)) {
        return
      }

      const content = await readFileFromFs(filePath, "utf-8")
      const lines = content.split(/\r?\n/)
      const relativePath = this.toDisplayPath(filePath)

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? ""
        if (!line.toLowerCase().includes(matcher)) {
          continue
        }

        results.push({
          path: relativePath,
          line: index + 1,
          snippet: line.trim(),
        })

        if (results.length >= maxResults) {
          return
        }
      }
    }

    if (fileStat.isFile()) {
      await searchFile(resolvedPath)
      return results
    }

    if (!fileStat.isDirectory()) {
      throw new WorkspaceError(
        "WORKSPACE_NOT_A_DIRECTORY",
        `Path ${normalizeForDisplay(path)} is not a directory or file`,
        { path, resolvedPath }
      )
    }

    await walkDirectory(resolvedPath, async (entryPath, kind) => {
      if (results.length >= maxResults) {
        return
      }

      if (kind !== "file") {
        return
      }

      const displayPath = this.toDisplayPath(entryPath)
      if (this.policy.blockSensitivePaths && isSensitiveWorkspacePath(displayPath, this.policy)) {
        return
      }

      await searchFile(entryPath)
    })

    return results
  }

  async writeFile(
    path: string,
    content: string,
    options: { overwrite?: boolean } = {}
  ): Promise<WorkspaceWriteFileResult> {
    this.assertWritable("write_file")
    const resolvedPath = await this.resolve(path)
    await this.assertWritableParent(resolvedPath, path)

    const existingStat = await stat(resolvedPath).catch(() => null)
    if (existingStat?.isDirectory()) {
      throw new WorkspaceError(
        "WORKSPACE_NOT_A_FILE",
        `Path ${normalizeForDisplay(path)} is a directory and cannot be overwritten by write_file`,
        { path }
      )
    }

    if (existingStat && !options.overwrite) {
      throw new WorkspaceError(
        "WORKSPACE_PATH_ALREADY_EXISTS",
        `Path ${normalizeForDisplay(path)} already exists`,
        { path }
      )
    }

    await writeFileToFs(resolvedPath, content, "utf-8")
    const writtenStat = await stat(resolvedPath)
    return {
      path: this.toDisplayPath(resolvedPath),
      size: writtenStat.size,
      bytesWritten: Buffer.byteLength(content, "utf-8"),
      created: !existingStat,
      overwritten: Boolean(existingStat),
    }
  }

  async editFile(path: string, patch: WorkspaceEditFilePatch): Promise<WorkspaceEditFileResult> {
    this.assertWritable("edit_file")
    if (!patch.search) {
      throw new WorkspaceError(
        "WORKSPACE_EDIT_CONFLICT",
        "edit_file search text cannot be empty",
        { path }
      )
    }

    const resolvedPath = await this.resolve(path)
    const fileStat = await stat(resolvedPath).catch(() => null)

    if (!fileStat) {
      throw new WorkspaceError(
        "WORKSPACE_PATH_NOT_FOUND",
        `Path ${normalizeForDisplay(path)} was not found`,
        { path }
      )
    }

    if (!fileStat.isFile()) {
      throw new WorkspaceError(
        "WORKSPACE_NOT_A_FILE",
        `Path ${normalizeForDisplay(path)} is not a file`,
        { path }
      )
    }

    const mimeType = Bun.file(resolvedPath).type || "application/octet-stream"
    if (!isTextMimeType(mimeType, resolvedPath)) {
      throw new WorkspaceError(
        "WORKSPACE_BINARY_FILE_UNSUPPORTED",
        `Binary file ${normalizeForDisplay(path)} is not supported by edit_file`,
        { path, mimeType }
      )
    }

    const content = await readFileFromFs(resolvedPath, "utf-8")
    const replacements = countOccurrences(content, patch.search)
    const expectedReplacements = patch.expectedReplacements ?? 1
    if (replacements !== expectedReplacements) {
      throw new WorkspaceError(
        "WORKSPACE_EDIT_CONFLICT",
        `Expected ${expectedReplacements} replacement${expectedReplacements === 1 ? "" : "s"} but found ${replacements}`,
        { path, expectedReplacements, replacements }
      )
    }

    const updatedContent = content.split(patch.search).join(patch.replace)
    const displayPath = this.toDisplayPath(resolvedPath)
    const diff = content === updatedContent
      ? undefined
      : buildUnifiedEditDiff(displayPath, content, updatedContent, patch.search, patch.replace)

    await writeFileToFs(resolvedPath, updatedContent, "utf-8")
    const updatedStat = await stat(resolvedPath)
    return {
      path: displayPath,
      size: updatedStat.size,
      replacements,
      changed: replacements > 0,
      ...(diff ? { diff } : {}),
    }
  }

  private normalizeInputPath(pathValue: string): string {
    if (!pathValue || pathValue.trim().length === 0) {
      return "."
    }

    return normalizePathSeparators(pathValue.trim())
  }

  private async resolveDirectoryPath(pathValue: string): Promise<string> {
    const candidatePath = isAbsolute(pathValue)
      ? resolve(pathValue)
      : resolve(this.rootPath, pathValue)

    const realCandidate = await resolveRealPathIfExists(candidatePath)
    if (realCandidate && normalizeForComparison(realCandidate) !== normalizeForComparison(candidatePath) && !isWithinRoot(realCandidate, this.rootPath)) {
      throw new WorkspaceError(
        "WORKSPACE_SYMLINK_ESCAPE",
        `Path ${normalizeForDisplay(pathValue)} resolves outside the workspace root through a symlink`,
        { path: pathValue, candidatePath: realCandidate, rootPath: this.rootPath }
      )
    }

    if (!realCandidate) {
      const realParent = await resolveRealPathIfExists(dirname(candidatePath))
      if (realParent && !isWithinRoot(realParent, this.rootPath)) {
        throw new WorkspaceError(
          "WORKSPACE_SYMLINK_ESCAPE",
          `Path ${normalizeForDisplay(pathValue)} resolves outside the workspace root through a parent symlink`,
          { path: pathValue, candidatePath: realParent, rootPath: this.rootPath }
        )
      }
    }

    if (!isWithinRoot(candidatePath, this.rootPath)) {
      throw new WorkspaceError(
        "WORKSPACE_PATH_OUTSIDE_ROOT",
        `Path ${normalizeForDisplay(pathValue)} is outside the workspace root`,
        { path: pathValue, candidatePath, rootPath: this.rootPath }
      )
    }

    const effectiveCandidate = realCandidate ?? candidatePath

    if (this.policy.blockSensitivePaths && isSensitiveWorkspacePath(effectiveCandidate, this.policy)) {
      throw new WorkspaceError(
        "WORKSPACE_SENSITIVE_PATH_BLOCKED",
        `Path ${normalizeForDisplay(pathValue)} is blocked by sandbox policy`,
        { path: pathValue, candidatePath: effectiveCandidate }
      )
    }

    return effectiveCandidate
  }

  private async resolveSingleFilePath(pathValue: string): Promise<string> {
    const filePath = this.fileOnlyPath
    if (!filePath) {
      return this.resolveDirectoryPath(pathValue)
    }

    const normalizedFilePath = normalizeForDisplay(filePath)
    const normalizedInput = normalizePathSeparators(pathValue)
    const absoluteCandidate = isAbsolute(normalizedInput)
      ? resolve(normalizedInput)
      : resolve(this.rootPath, normalizedInput)

    const resolved = await resolveRealPathIfExists(absoluteCandidate)
    const effectiveCandidate = resolved ?? absoluteCandidate

    if (effectiveCandidate === filePath) {
      return filePath
    }

    if (normalizedInput === "." || normalizedInput === "" || normalizedInput === basename(filePath)) {
      return filePath
    }

    throw new WorkspaceError(
      "WORKSPACE_NOT_A_FILE",
      `Only the approved file ${normalizedFilePath} is accessible in this mounted backend`,
      { path: pathValue, filePath }
    )
  }

  private toDisplayPath(pathValue: string): string {
    const relativePath = relative(this.rootPath, pathValue)
    const displayPath = !relativePath || relativePath === ""
      ? this.fileOnlyPath ? basename(pathValue) : "."
      : normalizeForDisplay(relativePath)

    if (this.displayPrefix) {
      if (displayPath === ".") {
        return this.displayPrefix
      }
      return `${this.displayPrefix}/${displayPath}`
    }

    return displayPath
  }

  private assertWritable(toolName: string): void {
    if (this.policy.readOnly) {
      throw new WorkspaceError(
        "WORKSPACE_ACCESS_DENIED",
        `${toolName} is not allowed on this read-only workspace backend`
      )
    }
  }

  private async assertWritableParent(resolvedPath: string, inputPath: string): Promise<void> {
    const parentPath = dirname(resolvedPath)
    const parentStat = await stat(parentPath).catch(() => null)
    if (!parentStat) {
      throw new WorkspaceError(
        "WORKSPACE_PARENT_NOT_FOUND",
        `Parent directory for ${normalizeForDisplay(inputPath)} does not exist`,
        { path: inputPath }
      )
    }

    if (!parentStat.isDirectory()) {
      throw new WorkspaceError(
        "WORKSPACE_NOT_A_DIRECTORY",
        `Parent path for ${normalizeForDisplay(inputPath)} is not a directory`,
        { path: inputPath }
      )
    }
  }
}

function normalizePattern(pattern: string): string {
  return pattern.replaceAll("\\", "/")
}

function normalizePathSeparators(pathValue: string): string {
  return pathValue.replaceAll("\\", "/")
}

function countOccurrences(content: string, search: string): number {
  if (!search) {
    return 0
  }

  let count = 0
  let index = 0
  while (true) {
    const foundIndex = content.indexOf(search, index)
    if (foundIndex === -1) {
      return count
    }
    count += 1
    index = foundIndex + search.length
  }
}

type ReplacementRange = {
  oldStartIndex: number
  oldEndIndex: number
  newStartIndex: number
  newEndIndex: number
}

type UnifiedHunkRange = {
  oldStartLine: number
  oldEndLine: number
  newStartLine: number
  newEndLine: number
}

function buildUnifiedEditDiff(
  displayPath: string,
  before: string,
  after: string,
  search: string,
  replace: string
): WorkspaceEditFileResult["diff"] {
  const diffPath = formatDiffPath(displayPath)
  const beforeLines = splitDiffLines(before)
  const afterLines = splitDiffLines(after)
  const replacementRanges = findReplacementRanges(before, search, replace)
  const hunkRanges = mergeUnifiedHunkRanges(
    replacementRanges.map((range) =>
      createUnifiedHunkRange(range, before, after, beforeLines.length, afterLines.length)
    )
  )

  const diffLines = [
    `diff --git a/${diffPath} b/${diffPath}`,
    `--- a/${diffPath}`,
    `+++ b/${diffPath}`,
  ]

  for (const range of hunkRanges) {
    const oldCount = range.oldEndLine - range.oldStartLine + 1
    const newCount = range.newEndLine - range.newStartLine + 1
    const oldSlice = beforeLines.slice(range.oldStartLine - 1, range.oldEndLine)
    const newSlice = afterLines.slice(range.newStartLine - 1, range.newEndLine)

    diffLines.push(`@@ -${range.oldStartLine},${oldCount} +${range.newStartLine},${newCount} @@`)
    diffLines.push(...buildUnifiedHunkLines(oldSlice, newSlice))
  }

  const fullText = diffLines.join("\n")
  const truncated = fullText.length > EDIT_FILE_DIFF_MAX_CHARS
  const text = truncated
    ? `${fullText.slice(0, EDIT_FILE_DIFF_MAX_CHARS)}\n... [diff truncated ${fullText.length - EDIT_FILE_DIFF_MAX_CHARS} characters]`
    : fullText

  return {
    format: "unified",
    text,
    truncated,
    additions: countDiffLines(diffLines, "+"),
    deletions: countDiffLines(diffLines, "-"),
    contextLines: EDIT_FILE_DIFF_CONTEXT_LINES,
  }
}

function findReplacementRanges(before: string, search: string, replace: string): ReplacementRange[] {
  const ranges: ReplacementRange[] = []
  let oldCursor = 0
  let newCursor = 0

  while (true) {
    const foundIndex = before.indexOf(search, oldCursor)
    if (foundIndex === -1) {
      return ranges
    }

    newCursor += foundIndex - oldCursor
    ranges.push({
      oldStartIndex: foundIndex,
      oldEndIndex: foundIndex + search.length,
      newStartIndex: newCursor,
      newEndIndex: newCursor + replace.length,
    })
    oldCursor = foundIndex + search.length
    newCursor += replace.length
  }
}

function createUnifiedHunkRange(
  range: ReplacementRange,
  before: string,
  after: string,
  beforeLineCount: number,
  afterLineCount: number
): UnifiedHunkRange {
  const beforeLineStarts = getLineStarts(before)
  const afterLineStarts = getLineStarts(after)
  const oldStartLine = getLineNumberForIndex(beforeLineStarts, range.oldStartIndex)
  const oldEndLine = getLineNumberForIndex(
    beforeLineStarts,
    Math.max(range.oldStartIndex, range.oldEndIndex - 1)
  )
  const newStartLine = getLineNumberForIndex(afterLineStarts, range.newStartIndex)
  const newEndLine = getLineNumberForIndex(
    afterLineStarts,
    Math.max(range.newStartIndex, range.newEndIndex - 1)
  )

  return {
    oldStartLine: Math.max(1, oldStartLine - EDIT_FILE_DIFF_CONTEXT_LINES),
    oldEndLine: Math.min(beforeLineCount, oldEndLine + EDIT_FILE_DIFF_CONTEXT_LINES),
    newStartLine: Math.max(1, newStartLine - EDIT_FILE_DIFF_CONTEXT_LINES),
    newEndLine: Math.min(afterLineCount, newEndLine + EDIT_FILE_DIFF_CONTEXT_LINES),
  }
}

function mergeUnifiedHunkRanges(ranges: UnifiedHunkRange[]): UnifiedHunkRange[] {
  const merged: UnifiedHunkRange[] = []

  for (const range of ranges.sort((left, right) => left.oldStartLine - right.oldStartLine)) {
    const current = merged.at(-1)
    if (
      !current ||
      (range.oldStartLine > current.oldEndLine + 1 &&
        range.newStartLine > current.newEndLine + 1)
    ) {
      merged.push({ ...range })
      continue
    }

    current.oldEndLine = Math.max(current.oldEndLine, range.oldEndLine)
    current.newEndLine = Math.max(current.newEndLine, range.newEndLine)
  }

  return merged
}

function buildUnifiedHunkLines(beforeLines: string[], afterLines: string[]): string[] {
  if (beforeLines.length * afterLines.length > EDIT_FILE_DIFF_MAX_LCS_CELLS) {
    return buildUnifiedHunkLinesWithCommonEdges(beforeLines, afterLines)
  }

  const lcs = Array.from(
    { length: beforeLines.length + 1 },
    () => Array<number>(afterLines.length + 1).fill(0)
  )

  for (let oldIndex = beforeLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = afterLines.length - 1; newIndex >= 0; newIndex -= 1) {
      lcs[oldIndex][newIndex] = beforeLines[oldIndex] === afterLines[newIndex]
        ? lcs[oldIndex + 1][newIndex + 1] + 1
        : Math.max(lcs[oldIndex + 1][newIndex], lcs[oldIndex][newIndex + 1])
    }
  }

  const lines: string[] = []
  let oldIndex = 0
  let newIndex = 0

  while (oldIndex < beforeLines.length && newIndex < afterLines.length) {
    if (beforeLines[oldIndex] === afterLines[newIndex]) {
      lines.push(` ${beforeLines[oldIndex]}`)
      oldIndex += 1
      newIndex += 1
      continue
    }

    if (lcs[oldIndex + 1][newIndex] >= lcs[oldIndex][newIndex + 1]) {
      lines.push(`-${beforeLines[oldIndex]}`)
      oldIndex += 1
      continue
    }

    lines.push(`+${afterLines[newIndex]}`)
    newIndex += 1
  }

  while (oldIndex < beforeLines.length) {
    lines.push(`-${beforeLines[oldIndex]}`)
    oldIndex += 1
  }
  while (newIndex < afterLines.length) {
    lines.push(`+${afterLines[newIndex]}`)
    newIndex += 1
  }

  return lines
}

function buildUnifiedHunkLinesWithCommonEdges(beforeLines: string[], afterLines: string[]): string[] {
  let prefixLength = 0
  while (
    prefixLength < beforeLines.length &&
    prefixLength < afterLines.length &&
    beforeLines[prefixLength] === afterLines[prefixLength]
  ) {
    prefixLength += 1
  }

  let suffixLength = 0
  while (
    suffixLength < beforeLines.length - prefixLength &&
    suffixLength < afterLines.length - prefixLength &&
    beforeLines[beforeLines.length - suffixLength - 1] ===
      afterLines[afterLines.length - suffixLength - 1]
  ) {
    suffixLength += 1
  }

  const lines: string[] = []
  for (const line of beforeLines.slice(0, prefixLength)) {
    lines.push(` ${line}`)
  }
  for (const line of beforeLines.slice(prefixLength, beforeLines.length - suffixLength)) {
    lines.push(`-${line}`)
  }
  for (const line of afterLines.slice(prefixLength, afterLines.length - suffixLength)) {
    lines.push(`+${line}`)
  }
  for (const line of beforeLines.slice(beforeLines.length - suffixLength)) {
    lines.push(` ${line}`)
  }

  return lines
}

function countDiffLines(lines: string[], prefix: "+" | "-"): number {
  const headerPrefix = prefix === "+" ? "+++" : "---"
  return lines.filter((line) => line.startsWith(prefix) && !line.startsWith(headerPrefix)).length
}

function splitDiffLines(text: string): string[] {
  return text.split(/\r?\n/)
}

function getLineStarts(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      starts.push(index + 1)
    }
  }
  return starts
}

function getLineNumberForIndex(lineStarts: number[], index: number): number {
  let low = 0
  let high = lineStarts.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (lineStarts[middle] <= index) {
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return Math.max(1, high + 1)
}

function formatDiffPath(pathValue: string): string {
  return normalizeForDisplay(pathValue).replace(/[\r\n]/g, " ")
}
