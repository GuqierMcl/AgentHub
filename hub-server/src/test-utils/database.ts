import { execFileSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..')

function resolveSqliteFilePath(dbUrl: string): string | null {
  if (!dbUrl.startsWith('file:')) {
    return null
  }

  if (dbUrl.startsWith('file://')) {
    return fileURLToPath(dbUrl)
  }

  const [pathPart] = dbUrl.slice('file:'.length).split('?')
  if (!pathPart || pathPart === ':memory:') {
    return null
  }

  return isAbsolute(pathPart) ? pathPart : resolve(PROJECT_ROOT, pathPart)
}

function ensureSqliteFile(dbUrl: string): void {
  const dbPath = resolveSqliteFilePath(dbUrl)
  if (!dbPath) {
    return
  }

  mkdirSync(dirname(dbPath), { recursive: true })
  closeSync(openSync(dbPath, 'a'))
}

export function prepareTestDatabase(dbUrl: string): void {
  ensureSqliteFile(dbUrl)
  execFileSync(process.execPath, ['run', 'dev:migrate'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'pipe',
  })
}
