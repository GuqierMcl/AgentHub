export type UnifiedDiffLineType = "context" | "addition" | "deletion" | "meta"

export type UnifiedDiffLine = {
  type: UnifiedDiffLineType
  content: string
  oldLine?: number
  newLine?: number
}

export type UnifiedDiffHunk = {
  header: string
  oldStart?: number
  oldLines?: number
  newStart?: number
  newLines?: number
  lines: UnifiedDiffLine[]
}

export type UnifiedDiffFile = {
  path: string
  oldPath?: string
  status?: string
  binary?: boolean
  headerLines: string[]
  hunks: UnifiedDiffHunk[]
}

type MutableDiffFile = UnifiedDiffFile & {
  currentHunk?: UnifiedDiffHunk
  oldCursor?: number
  newCursor?: number
}

export function parseUnifiedDiff(patchText: string): UnifiedDiffFile[] {
  const files: UnifiedDiffFile[] = []
  let current: MutableDiffFile | undefined

  const finishCurrent = () => {
    if (!current) return
    const file: UnifiedDiffFile = {
      path: current.path,
      oldPath: current.oldPath,
      status: current.status,
      binary: current.binary,
      headerLines: current.headerLines,
      hunks: current.hunks,
    }
    if (file.path || file.oldPath || file.hunks.length || file.headerLines.length) {
      files.push({
        ...file,
        path: file.path || file.oldPath || "unknown",
      })
    }
    current = undefined
  }

  const ensureCurrent = () => {
    current ??= {
      path: "",
      headerLines: [],
      hunks: [],
    }
    return current
  }

  const lines = patchText.replace(/\r?\n$/, "").split(/\r?\n/)
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      finishCurrent()
      current = createFileFromDiffGitLine(line)
      current.headerLines.push(line)
      continue
    }

    if (!current && line.startsWith("--- ")) {
      current = {
        path: "",
        oldPath: normalizeDiffPath(line.slice(4)),
        headerLines: [line],
        hunks: [],
      }
      continue
    }

    if (!current && !line.trim()) continue
    const file = ensureCurrent()

    if (line.startsWith("--- ")) {
      const oldPath = normalizeDiffPath(line.slice(4))
      if (oldPath) file.oldPath = oldPath
      file.headerLines.push(line)
      continue
    }

    if (line.startsWith("+++ ")) {
      const newPath = normalizeDiffPath(line.slice(4))
      if (newPath) file.path = newPath
      file.headerLines.push(line)
      continue
    }

    if (line.startsWith("@@ ")) {
      const hunk = parseHunkHeader(line)
      file.currentHunk = hunk
      file.oldCursor = hunk.oldStart
      file.newCursor = hunk.newStart
      file.hunks.push(hunk)
      continue
    }

    if (!file.currentHunk) {
      applyFileMetadata(file, line)
      file.headerLines.push(line)
      continue
    }

    appendHunkLine(file, line)
  }

  finishCurrent()
  return files
}

function createFileFromDiffGitLine(line: string): MutableDiffFile {
  const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
  const oldPath = match?.[1]
  const path = match?.[2] ?? oldPath ?? ""
  return {
    path,
    ...(oldPath && oldPath !== path ? { oldPath } : {}),
    headerLines: [],
    hunks: [],
  }
}

function applyFileMetadata(file: MutableDiffFile, line: string): void {
  if (line.startsWith("new file mode")) {
    file.status = "added"
  } else if (line.startsWith("deleted file mode")) {
    file.status = "deleted"
  } else if (line.startsWith("rename from ")) {
    file.oldPath = line.slice("rename from ".length)
    file.status = "renamed"
  } else if (line.startsWith("rename to ")) {
    file.path = line.slice("rename to ".length)
    file.status = "renamed"
  } else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
    file.binary = true
  }
}

function parseHunkHeader(header: string): UnifiedDiffHunk {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header)
  return {
    header,
    oldStart: parseOptionalNumber(match?.[1]),
    oldLines: parseOptionalNumber(match?.[2]) ?? 1,
    newStart: parseOptionalNumber(match?.[3]),
    newLines: parseOptionalNumber(match?.[4]) ?? 1,
    lines: [],
  }
}

function appendHunkLine(file: MutableDiffFile, line: string): void {
  const hunk = file.currentHunk
  if (!hunk) return

  if (line.startsWith("\\ No newline")) {
    hunk.lines.push({ type: "meta", content: line })
    return
  }

  const oldCursor = file.oldCursor
  const newCursor = file.newCursor
  const marker = line[0]
  const content = line.slice(1)

  if (marker === "+") {
    hunk.lines.push({
      type: "addition",
      content,
      ...(newCursor !== undefined ? { newLine: newCursor } : {}),
    })
    file.newCursor = newCursor === undefined ? undefined : newCursor + 1
    return
  }

  if (marker === "-") {
    hunk.lines.push({
      type: "deletion",
      content,
      ...(oldCursor !== undefined ? { oldLine: oldCursor } : {}),
    })
    file.oldCursor = oldCursor === undefined ? undefined : oldCursor + 1
    return
  }

  hunk.lines.push({
    type: marker === " " ? "context" : "meta",
    content: marker === " " ? content : line,
    ...(oldCursor !== undefined ? { oldLine: oldCursor } : {}),
    ...(newCursor !== undefined ? { newLine: newCursor } : {}),
  })
  if (marker === " ") {
    file.oldCursor = oldCursor === undefined ? undefined : oldCursor + 1
    file.newCursor = newCursor === undefined ? undefined : newCursor + 1
  }
}

function normalizeDiffPath(path: string): string | undefined {
  const trimmed = path.trim()
  if (!trimmed || trimmed === "/dev/null") return undefined
  return trimmed.replace(/^[ab]\//, "")
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}
