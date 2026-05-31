import { Hono, Context } from 'hono'
import { spawnSync, execSync } from 'node:child_process'
import { platform, tmpdir } from 'node:os'
import { existsSync, writeFileSync, unlinkSync, readFileSync, readdirSync, statSync, createReadStream, openSync, readSync, closeSync } from 'node:fs'
import { Readable } from 'node:stream'
import { join, resolve, relative, sep, extname, basename } from 'node:path'
import { logger } from '../lib/logger'
import { AppError, notFound, badRequest, forbidden, conflict } from '../lib/errors'
import { findConversationById } from '../repositories/conversation.repo'

const workspace = new Hono()

// ── MIME type helpers ──

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.css', '.scss', '.less', '.html',
  '.htm', '.vue', '.svelte', '.sql', '.sh', '.bash', '.zsh', '.ps1', '.py', '.rb',
  '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.swift', '.kt', '.scala',
  '.r', '.lua', '.php', '.dart', '.env', '.gitignore', '.dockerignore', '.editorconfig',
  '.prisma', '.graphql', '.gql',
])

const EDITABLE_TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.css', '.scss', '.less', '.html',
  '.htm', '.sql', '.sh', '.bash', '.zsh', '.ps1', '.py',
  '.java', '.go', '.rs',
  '.env', '.gitignore', '.dockerignore', '.editorconfig',
  '.prisma', '.graphql', '.gql',
  '.log', '.csv',
])

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico',
])

const PDF_EXTENSIONS = new Set(['.pdf'])

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a', '.wma',
])

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.webm', '.avi', '.mov', '.mkv', '.wmv', '.flv',
])

const OFFICE_WORD_EXTENSIONS = new Set(['.docx'])
const OFFICE_WORD_LEGACY_EXTENSIONS = new Set(['.doc'])

const OFFICE_SHEET_EXTENSIONS = new Set(['.xlsx'])
const OFFICE_SHEET_LEGACY_EXTENSIONS = new Set(['.xls'])

// Extension → language label mapping for text files
const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript JSX',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript JSX',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.less': 'Less',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.json': 'JSON',
  '.xml': 'XML',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.toml': 'TOML',
  '.md': 'Markdown',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.java': 'Java',
  '.c': 'C',
  '.cpp': 'C++',
  '.h': 'C Header',
  '.hpp': 'C++ Header',
  '.cs': 'C#',
  '.go': 'Go',
  '.rs': 'Rust',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
  '.scala': 'Scala',
  '.php': 'PHP',
  '.r': 'R',
  '.lua': 'Lua',
  '.dart': 'Dart',
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.bash': 'Bash',
  '.zsh': 'Zsh',
  '.ps1': 'PowerShell',
  '.env': 'Env',
  '.txt': 'Text',
  '.log': 'Log',
  '.csv': 'CSV',
  '.ini': 'INI',
  '.cfg': 'Config',
  '.conf': 'Config',
  '.prisma': 'Prisma',
  '.graphql': 'GraphQL',
  '.gql': 'GraphQL',
  '.gitignore': 'Git Ignore',
  '.dockerignore': 'Docker Ignore',
  '.editorconfig': 'EditorConfig',
}

function getDetectedKind(ext: string): 'text' | 'image' | 'pdf' | 'audio' | 'video' | 'office-word' | 'office-sheet' | 'binary' {
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (PDF_EXTENSIONS.has(ext)) return 'pdf'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (OFFICE_WORD_EXTENSIONS.has(ext)) return 'office-word'
  if (OFFICE_SHEET_EXTENSIONS.has(ext)) return 'office-sheet'
  return 'binary'
}

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  if (TEXT_EXTENSIONS.has(ext)) return 'text/plain'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.bmp') return 'image/bmp'
  if (ext === '.ico') return 'image/x-icon'
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.mp3') return 'audio/mpeg'
  if (ext === '.wav') return 'audio/wav'
  if (ext === '.ogg') return 'audio/ogg'
  if (ext === '.aac') return 'audio/aac'
  if (ext === '.flac') return 'audio/flac'
  if (ext === '.m4a') return 'audio/mp4'
  if (ext === '.wma') return 'audio/x-ms-wma'
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.avi') return 'video/x-msvideo'
  if (ext === '.mov') return 'video/quicktime'
  if (ext === '.mkv') return 'video/x-matroska'
  if (ext === '.wmv') return 'video/x-ms-wmv'
  if (ext === '.flv') return 'video/x-flv'
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (ext === '.doc') return 'application/msword'
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (ext === '.xls') return 'application/vnd.ms-excel'
  return 'application/octet-stream'
}

// ── Workspace helpers ──

type WorkspaceInfo = {
  workspaceId: string
  rootPath: string
}

async function resolveWorkspace(conversationId: string): Promise<WorkspaceInfo> {
  const conv = await findConversationById(conversationId)
  if (!conv) {
    throw notFound('CONVERSATION_NOT_FOUND', '会话不存在')
  }

  const ws = (conv.metadataJson as Record<string, unknown>)?.workspace as Record<string, string> | undefined
  if (!ws?.rootPath) {
    throw badRequest('WORKSPACE_NOT_BOUND', '当前会话未绑定工作空间')
  }

  if (!existsSync(ws.rootPath)) {
    throw badRequest('WORKSPACE_PATH_NOT_FOUND', `工作空间目录不存在: ${ws.rootPath}`)
  }

  return {
    workspaceId: (ws.workspaceId as string) ?? 'unknown',
    rootPath: ws.rootPath,
  }
}

function resolveSafePath(rootPath: string, relativePath: string): string {
  // Normalize path separators
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  const resolved = resolve(rootPath, normalized)

  // Prevent path traversal
  const relativeResolved = relative(rootPath, resolved)
  // relative() returns "" when paths are identical (safe)
  if (typeof relativeResolved !== 'string' || relativeResolved.startsWith('..') || (relativeResolved !== '' && relativeResolved.startsWith(sep))) {
    throw badRequest('WORKSPACE_ACCESS_DENIED', '拒绝访问工作空间外部路径')
  }

  if (!existsSync(resolved)) {
    throw notFound('WORKSPACE_PATH_NOT_FOUND', `路径不存在: ${relativePath}`)
  }

  return resolved
}

// ── Routes ──

workspace.post('/api/workspace/select', async (c: Context) => {
  try {
    const os = platform()
    let selectedPath = ''

    if (os === 'win32') {
      const outFile = join(tmpdir(), `workspace-select-out-${Date.now()}.txt`)
      const psScript = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$f = New-Object System.Windows.Forms.FolderBrowserDialog',
        '$f.Description = ""',
        '$f.ShowNewFolderButton = $false',
        '$result = $f.ShowDialog()',
        `if ($result -eq 'OK') { $f.SelectedPath | Out-File -FilePath '${outFile.replace(/\\/g, '\\\\')}' -Encoding UTF8 }`,
      ].join('; ')
      const tmpFile = join(tmpdir(), `workspace-select-${Date.now()}.ps1`)
      writeFileSync(tmpFile, '\uFEFF' + psScript, 'utf-8')
      try {
        spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpFile], {
          stdio: 'ignore',
          timeout: 300000,
        })
        try {
          const output = readFileSync(outFile, 'utf-8').trim()
          if (output) selectedPath = output
        } catch { /* ignore */ }
      } finally {
        try { unlinkSync(tmpFile) } catch { /* ignore */ }
        try { unlinkSync(outFile) } catch { /* ignore */ }
      }
    } else if (os === 'darwin') {
      const result = execSync(
        `osascript -e 'tell app "System Events" to POSIX path of (choose folder with prompt "选择工作空间目录")'`,
        { encoding: 'utf-8', timeout: 120000, stdio: ['pipe', 'pipe', 'ignore'] }
      ).trim()
      if (result) selectedPath = result
    } else {
      const result = execSync(
        `zenity --file-selection --directory --title="选择工作空间目录"`,
        { encoding: 'utf-8', timeout: 120000, stdio: ['pipe', 'pipe', 'ignore'] }
      ).trim()
      if (result) selectedPath = result
    }

    if (!selectedPath) {
      return c.json({ path: null })
    }

    if (!existsSync(selectedPath)) {
      logger.warn({ selectedPath }, 'Selected workspace path does not exist')
    }

    return c.json({ path: selectedPath })
  } catch (err) {
    logger.debug({ err }, 'Workspace select cancelled or failed')
    return c.json({ path: null })
  }
})

workspace.get('/api/conversations/:id/workspace/tree', async (c: Context) => {
  const conversationId = c.req.param('id')!
  const relativePath = c.req.query('path') ?? '.'

  try {
    const { rootPath } = await resolveWorkspace(conversationId)
    const resolvedPath = resolveSafePath(rootPath, relativePath)

    const stat = statSync(resolvedPath)
    if (!stat.isDirectory()) {
      throw badRequest('WORKSPACE_INVALID_PATH', '指定的路径不是目录')
    }

    const dirents = readdirSync(resolvedPath, { withFileTypes: true })
    const entries = dirents
      .map((d) => {
        const name = d.name
        // Skip hidden files
        if (name.startsWith('.') && name !== '.gitignore') return null
        const childRelative = relative(rootPath, join(resolvedPath, name))
        const isDir = d.isDirectory()
        // Check if directory has children
        let hasChildren = false
        if (isDir) {
          try {
            const children = readdirSync(join(resolvedPath, name))
            hasChildren = children.length > 0
          } catch {
            hasChildren = false
          }
        }
        return {
          name,
          path: childRelative.replace(/\\/g, '/'),
          kind: isDir ? 'dir' as const : 'file' as const,
          hasChildren: isDir ? hasChildren : undefined,
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        // Directories first, then files
        if (a!.kind !== b!.kind) return a!.kind === 'dir' ? -1 : 1
        return a!.name.localeCompare(b!.name)
      })

    const rootLabel = basename(rootPath)

    return c.json({
      workspace: {
        workspaceId: `${conversationId}-workspace`,
        backendType: 'local' as const,
        rootLabel,
      },
      parentPath: relativePath === '.' ? '.' : resolve(relativePath, '..').replace(/\\/g, '/'),
      entries,
    })
  } catch (err) {
    if (err instanceof Error && 'code' in err) throw err
    logger.error({ err, conversationId, relativePath }, 'Workspace tree error')
    throw err
  }
})

workspace.get('/api/conversations/:id/workspace/file-content', async (c: Context) => {
  const conversationId = c.req.param('id')!
  const relativePath = c.req.query('path') ?? ''

  try {
    const { rootPath } = await resolveWorkspace(conversationId)
    const resolvedPath = resolveSafePath(rootPath, relativePath)

    const stat = statSync(resolvedPath)
    if (!stat.isFile()) {
      throw badRequest('WORKSPACE_INVALID_PATH', '指定的路径不是文件')
    }

    const mimeType = getMimeType(resolvedPath)
    const fileSize = stat.size
    const rangeHeader = c.req.header('Range') || c.req.header('range')

    if (rangeHeader) {
      const match = rangeHeader.replace(/bytes=\s*/i, '').match(/^(\d+)-(\d*)$/)
      if (match) {
        const start = parseInt(match[1], 10)
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1
        const chunkSize = end - start + 1
        const nodeStream = createReadStream(resolvedPath, { start, end })
        const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>
        return c.body(webStream, 206, {
          'Content-Type': mimeType,
          'Content-Length': chunkSize.toString(),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
        })
      }
    }

    const nodeStream = createReadStream(resolvedPath)
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>
    return c.body(webStream, 200, {
      'Content-Type': mimeType,
      'Content-Length': fileSize.toString(),
      'Accept-Ranges': 'bytes',
    })
  } catch (err) {
    if (err instanceof Error && 'code' in err) throw err
    logger.error({ err, conversationId, relativePath }, 'Workspace file-content error')
    throw err
  }
})

workspace.get('/api/conversations/:id/workspace/file', async (c: Context) => {
  const conversationId = c.req.param('id')!
  const relativePath = c.req.query('path') ?? ''

  try {
    const { rootPath } = await resolveWorkspace(conversationId)
    const resolvedPath = resolveSafePath(rootPath, relativePath)

    const stat = statSync(resolvedPath)
    if (!stat.isFile()) {
      throw badRequest('WORKSPACE_INVALID_PATH', '指定的路径不是文件')
    }

    const mimeType = getMimeType(resolvedPath)
    const size = stat.size
    const name = basename(resolvedPath)
    const ext = extname(resolvedPath).toLowerCase()
    const kind = getDetectedKind(ext)
    const fileContentUrl = `/api/conversations/${encodeURIComponent(conversationId)}/workspace/file-content?path=${encodeURIComponent(relativePath)}`

    // Legacy Office formats - not supported in first version
    if (OFFICE_WORD_LEGACY_EXTENSIONS.has(ext)) {
      return c.json({
        kind: 'unsupported',
        path: relativePath,
        name,
        mimeType,
        size,
        message: '暂不支持预览 .doc 格式，建议转换为 .docx',
      })
    }
    if (OFFICE_SHEET_LEGACY_EXTENSIONS.has(ext)) {
      return c.json({
        kind: 'unsupported',
        path: relativePath,
        name,
        mimeType,
        size,
        message: '暂不支持预览 .xls 格式，建议转换为 .xlsx',
      })
    }

    // Image files
    if (kind === 'image') {
      if (size > 5 * 1024 * 1024) {
        return c.json({
          kind: 'unsupported',
          path: relativePath,
          name,
          mimeType,
          size,
          message: '图片文件过大 (超过 5MB)',
        })
      }
      try {
        const buffer = readFileSync(resolvedPath)
        const base64 = buffer.toString('base64')
        return c.json({
          kind: 'image',
          path: relativePath,
          name,
          mimeType,
          size,
          base64: `data:${mimeType};base64,${base64}`,
        })
      } catch {
        return c.json({
          kind: 'unsupported',
          path: relativePath,
          name,
          mimeType,
          size,
          message: '无法读取图片文件',
        })
      }
    }

    // PDF files
    if (kind === 'pdf') {
      return c.json({
        kind: 'pdf',
        path: relativePath,
        name,
        mimeType,
        size,
        url: fileContentUrl,
      })
    }

    // Audio files
    if (kind === 'audio') {
      return c.json({
        kind: 'audio',
        path: relativePath,
        name,
        mimeType,
        size,
        url: fileContentUrl,
      })
    }

    // Video files
    if (kind === 'video') {
      return c.json({
        kind: 'video',
        path: relativePath,
        name,
        mimeType,
        size,
        url: fileContentUrl,
      })
    }

    // Office Word files
    if (kind === 'office-word') {
      return c.json({
        kind: 'office-word',
        path: relativePath,
        name,
        mimeType,
        size,
        url: fileContentUrl,
      })
    }

    // Office Sheet files
    if (kind === 'office-sheet') {
      try {
        const { generateSheetMarkdown } = await import('../services/excel-preview.service')
        const content = await generateSheetMarkdown(resolvedPath)
        return c.json({
          kind: 'text',
          path: relativePath,
          name,
          mimeType: 'text/markdown',
          size,
          content,
          language: 'Markdown',
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Excel 预览解析失败'
        return c.json({
          kind: 'unsupported',
          path: relativePath,
          name,
          mimeType,
          size,
          message,
        })
      }
    }

    // Text files
    if (kind === 'text') {
      const textPreviewMaxSize = 1024 * 1024 // 1MB
      const textTruncateSize = 512000 // 500KB
      let truncated = false

      if (size > 5 * 1024 * 1024) {
        return c.json({
          kind: 'binary',
          path: relativePath,
          name,
          mimeType,
          size,
          message: '文件过大，无法预览',
        })
      }

      try {
        let content: string
        if (size > textPreviewMaxSize) {
          const fd = openSync(resolvedPath, 'r')
          const buffer = Buffer.alloc(textTruncateSize)
          readSync(fd, buffer, 0, textTruncateSize, 0)
          closeSync(fd)
          content = buffer.toString('utf-8') + '\n\n... (文件过大，已截断)'
          truncated = true
        } else {
          content = readFileSync(resolvedPath, 'utf-8')
        }

        return c.json({
          kind: 'text',
          path: relativePath,
          name,
          mimeType,
          size,
          content,
          language: LANGUAGE_MAP[ext],
          truncated,
        })
      } catch {
        return c.json({
          kind: 'unsupported',
          path: relativePath,
          name,
          mimeType,
          size,
          message: '无法读取文件内容',
        })
      }
    }

    // Binary files
    if (kind === 'binary') {
      return c.json({
        kind: 'binary',
        path: relativePath,
        name,
        mimeType,
        size,
        message: '暂不支持预览此类型文件',
      })
    }

    // Fallback
    return c.json({
      kind: 'unsupported',
      path: relativePath,
      name,
      mimeType,
      size,
      message: `暂不支持预览此类型文件 (${mimeType})`,
    })
  } catch (err) {
    if (err instanceof Error && 'code' in err) throw err
    logger.error({ err, conversationId, relativePath }, 'Workspace file error')
    throw err
  }
})

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', '.nuxt', 'coverage', '.turbo', '.cache'])

workspace.get('/api/conversations/:id/workspace/search', async (c: Context) => {
  const conversationId = c.req.param('id')!
  const query = (c.req.query('q') ?? '').toLowerCase()

  if (!query) {
    return c.json({ entries: [] })
  }

  try {
    const { rootPath } = await resolveWorkspace(conversationId)

    const results: { name: string; path: string; kind: 'file' | 'dir'; hasChildren?: boolean }[] = []
    const maxResults = 200

    function walk(dirPath: string) {
      if (results.length >= maxResults) return
      let entries
      try {
        entries = readdirSync(dirPath, { withFileTypes: true })
      } catch {
        return
      }
      for (const d of entries) {
        if (results.length >= maxResults) return
        const name = d.name
        if (name.startsWith('.') || SKIP_DIRS.has(name)) continue
        const fullPath = join(dirPath, name)
        const relativePath = relative(rootPath, fullPath).replace(/\\/g, '/')
        if (name.toLowerCase().includes(query)) {
          const isDir = d.isDirectory()
          const entry: typeof results[0] = { name, path: relativePath, kind: isDir ? 'dir' : 'file' }
          if (isDir) entry.hasChildren = true
          results.push(entry)
        }
        if (d.isDirectory()) {
          walk(fullPath)
        }
      }
    }

    walk(rootPath)
    return c.json({ entries: results })
  } catch (err) {
    if (err instanceof Error && 'code' in err) throw err
    logger.error({ err, conversationId, query }, 'Workspace search error')
    throw err
  }
})

// ── Workspace File Edit Routes ──

const EDITABLE_MAX_SIZE = 1024 * 1024 // 1MB

function getFileRevision(resolvedPath: string): string {
  const stat = statSync(resolvedPath)
  return `${stat.mtimeMs}-${stat.size}`
}

workspace.get('/api/conversations/:id/workspace/file-edit', async (c: Context) => {
  const conversationId = c.req.param('id')!
  const relativePath = c.req.query('path') ?? ''

  try {
    const { rootPath } = await resolveWorkspace(conversationId)
    const resolvedPath = resolveSafePath(rootPath, relativePath)

    const stat = statSync(resolvedPath)
    if (!stat.isFile()) {
      throw badRequest('WORKSPACE_INVALID_PATH', '指定的路径不是文件')
    }

    const ext = extname(resolvedPath).toLowerCase()
    if (!EDITABLE_TEXT_EXTENSIONS.has(ext)) {
      throw forbidden('WORKSPACE_FILE_NOT_EDITABLE', '当前文件类型不支持编辑')
    }

    if (stat.size > EDITABLE_MAX_SIZE) {
      throw new AppError(413, 'WORKSPACE_FILE_TOO_LARGE', '文件过大，无法编辑（上限 1MB）')
    }

    const content = readFileSync(resolvedPath, 'utf-8')
    const name = basename(resolvedPath)
    const mimeType = getMimeType(resolvedPath)
    const revision = getFileRevision(resolvedPath)

    return c.json({
      path: relativePath,
      name,
      mimeType,
      size: stat.size,
      content,
      language: LANGUAGE_MAP[ext],
      encoding: 'utf-8' as const,
      revision,
      editable: true,
    })
  } catch (err) {
    if (err instanceof Error && 'code' in err) throw err
    logger.error({ err, conversationId, relativePath }, 'Workspace file-edit error')
    throw err
  }
})

workspace.put('/api/conversations/:id/workspace/file', async (c: Context) => {
  const conversationId = c.req.param('id')!
  const body = await c.req.json<{ path: string; content: string; revision: string }>()

  const relativePath = body.path
  const newContent = body.content
  const clientRevision = body.revision

  if (!relativePath || typeof newContent !== 'string' || typeof clientRevision !== 'string') {
    throw badRequest('WORKSPACE_INVALID_INPUT', '请求参数缺失或类型不正确')
  }

  try {
    const { rootPath } = await resolveWorkspace(conversationId)
    const resolvedPath = resolveSafePath(rootPath, relativePath)

    const stat = statSync(resolvedPath)
    if (!stat.isFile()) {
      throw badRequest('WORKSPACE_INVALID_PATH', '指定的路径不是文件')
    }

    const ext = extname(resolvedPath).toLowerCase()
    if (!EDITABLE_TEXT_EXTENSIONS.has(ext)) {
      throw forbidden('WORKSPACE_FILE_NOT_EDITABLE', '当前文件类型不支持编辑')
    }

    if (stat.size > EDITABLE_MAX_SIZE) {
      throw new AppError(413, 'WORKSPACE_FILE_TOO_LARGE', '文件过大，无法编辑（上限 1MB）')
    }

    // Revision conflict detection
    const currentRevision = getFileRevision(resolvedPath)
    if (currentRevision !== clientRevision) {
      throw conflict('WORKSPACE_FILE_CONFLICT', '文件已被外部修改，请重新加载后重试')
    }

    // Write file
    try {
      writeFileSync(resolvedPath, newContent, 'utf-8')
    } catch {
      throw new AppError(500, 'WORKSPACE_FILE_WRITE_FAILED', '文件写入失败')
    }

    const newStat = statSync(resolvedPath)
    const newRevision = getFileRevision(resolvedPath)
    const savedAt = new Date().toISOString()

    return c.json({
      path: relativePath,
      size: newStat.size,
      revision: newRevision,
      savedAt,
    })
  } catch (err) {
    if (err instanceof Error && 'code' in err) throw err
    logger.error({ err, conversationId, relativePath }, 'Workspace file write error')
    throw err
  }
})

export default workspace
