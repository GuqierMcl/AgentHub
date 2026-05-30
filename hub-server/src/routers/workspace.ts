import { Hono, Context } from 'hono'
import { spawnSync, execSync } from 'node:child_process'
import { platform, tmpdir } from 'node:os'
import { existsSync, writeFileSync, unlinkSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative, sep, extname, basename } from 'node:path'
import { logger } from '../lib/logger'
import { notFound, badRequest } from '../lib/errors'
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

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico',
])

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

    // Text files
    if (TEXT_EXTENSIONS.has(extname(resolvedPath).toLowerCase())) {
      try {
        const content = readFileSync(resolvedPath, 'utf-8')
        // Limit text preview to 500KB
        const truncated = content.length > 512000 ? content.slice(0, 512000) + '\n\n... (文件过大，已截断)' : content
        return c.json({
          kind: 'text',
          path: relativePath,
          name,
          mimeType,
          size,
          content: truncated,
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

    // Image files
    if (IMAGE_EXTENSIONS.has(extname(resolvedPath).toLowerCase())) {
      // Limit image preview to 5MB
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

    // Unsupported files
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

export default workspace
