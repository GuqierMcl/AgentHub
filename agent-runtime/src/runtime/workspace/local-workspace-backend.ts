import { existsSync, mkdirSync } from "node:fs"
import { readFile as readFileFromFs, readdir, stat, realpath } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve } from "node:path"
import type {
  SandboxPolicy,
  WorkspaceBackend,
  WorkspaceBackendCapabilities,
  WorkspaceContentBlock,
  WorkspaceGrepMatch,
  WorkspaceListEntry,
  WorkspaceReadFileResult,
} from "./types"
import { WorkspaceError } from "./types"

const DEFAULT_BLOCKED_BASENAMES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".npmrc",
  ".gitignore",
  "id_rsa",
]

const DEFAULT_BLOCKED_EXTENSIONS = [".pem", ".key"]

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

export type LocalWorkspaceBackendOptions = {
  fileOnlyPath?: string
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

function hasSensitiveSegments(pathValue: string, policy: SandboxPolicy): boolean {
  const normalized = normalizeForDisplay(pathValue)
  const segments = normalized.split("/").filter(Boolean)
  const fileName = segments[segments.length - 1] ?? ""
  const extension = extname(fileName).toLowerCase()

  if (policy.blockedBasenames.includes(fileName)) {
    return true
  }

  if (policy.blockedExtensions.includes(extension)) {
    return true
  }

  return segments.some((segment) => segment === ".git" || segment === ".svn" || segment === ".hg")
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/")
}

function isTextMimeType(mimeType: string, pathValue: string): boolean {
  if (mimeType.startsWith("text/")) {
    return true
  }

  const extension = extname(pathValue).toLowerCase()
  return TEXT_EXTENSIONS.has(extension)
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
  private policy: SandboxPolicy

  constructor(rootPath: string, options: LocalWorkspaceBackendOptions = {}) {
    this.rootPath = resolve(rootPath)
    this.fileOnlyPath = options.fileOnlyPath ? resolve(options.fileOnlyPath) : undefined
    this.policy = {
      readOnly: options.sandboxPolicy?.readOnly ?? true,
      blockSensitivePaths: options.sandboxPolicy?.blockSensitivePaths ?? true,
      allowExternalAccess: options.sandboxPolicy?.allowExternalAccess ?? false,
      blockedBasenames: options.sandboxPolicy?.blockedBasenames ?? DEFAULT_BLOCKED_BASENAMES,
      blockedExtensions: options.sandboxPolicy?.blockedExtensions ?? DEFAULT_BLOCKED_EXTENSIONS,
    }

    if (!existsSync(this.rootPath)) {
      mkdirSync(this.rootPath, { recursive: true })
    }
  }

  capabilities(): WorkspaceBackendCapabilities {
    return {
      read: true,
      write: false,
      edit: false,
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

      if (this.policy.blockSensitivePaths && hasSensitiveSegments(displayPath, this.policy)) {
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
      if (this.policy.blockSensitivePaths && hasSensitiveSegments(relativePath, this.policy)) {
        return
      }

      if (glob.match(relativePath)) {
        matches.push(relativePath)
      }

      if (kind === "dir") {
        const directoryRelativePath = `${relativePath}/`
        if (glob.match(directoryRelativePath)) {
          matches.push(relativePath)
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
      if (this.policy.blockSensitivePaths && hasSensitiveSegments(displayPath, this.policy)) {
        return
      }

      await searchFile(entryPath)
    })

    return results
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

    if (!isWithinRoot(candidatePath, this.rootPath)) {
      throw new WorkspaceError(
        "WORKSPACE_PATH_OUTSIDE_ROOT",
        `Path ${normalizeForDisplay(pathValue)} is outside the workspace root`,
        { path: pathValue, candidatePath, rootPath: this.rootPath }
      )
    }

    const effectiveCandidate = realCandidate ?? candidatePath

    if (this.policy.blockSensitivePaths && hasSensitiveSegments(effectiveCandidate, this.policy)) {
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
    if (!relativePath || relativePath === "") {
      return basename(pathValue)
    }

    return normalizeForDisplay(relativePath)
  }
}

function normalizePattern(pattern: string): string {
  return pattern.replaceAll("\\", "/")
}

function normalizePathSeparators(pathValue: string): string {
  return pathValue.replaceAll("\\", "/")
}
