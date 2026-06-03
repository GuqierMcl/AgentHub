import { execFileSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import os from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(import.meta.dir, '..')

function getDefaultDataDir(): string {
  const envDir = process.env.AGENTHUB_DATA_DIR
  if (envDir) return envDir

  const platform = os.platform()
  if (platform === 'win32') {
    return resolve(os.homedir(), 'AppData', 'Roaming', 'AgentHub')
  }
  if (platform === 'darwin') {
    return resolve(os.homedir(), 'Library', 'Application Support', 'AgentHub')
  }
  return resolve(os.homedir(), '.local', 'share', 'AgentHub')
}

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

const dataDir = resolve(getDefaultDataDir())
const databaseUrl = process.env.DATABASE_URL ?? `file:${resolve(dataDir, 'hub.db')}`

ensureSqliteFile(databaseUrl)

execFileSync(process.execPath, ['run', 'prisma:migrate:deploy'], {
  cwd: PROJECT_ROOT,
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'inherit',
})
