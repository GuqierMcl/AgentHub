import { PrismaLibSql } from '@prisma/adapter-libsql'
import { execSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PrismaClient } from '../generated/prisma/client'

let prisma: PrismaClient | null = null

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

function cleanupWalFiles(dbPath: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const walPath = dbPath + suffix
    if (existsSync(walPath)) {
      try {
        // Truncate WAL files to force SQLite to start fresh
        closeSync(openSync(walPath, 'w'))
      } catch {
        // Ignore errors cleaning up stale files
      }
    }
  }
}

function isPrismaClientUpToDate(): boolean {
  const schemaPath = resolve(PROJECT_ROOT, 'prisma', 'schema.prisma')
  const clientPath = resolve(PROJECT_ROOT, 'src', 'generated', 'prisma', 'client.ts')
  if (!existsSync(clientPath) || !existsSync(schemaPath)) {
    return false
  }
  return statSync(clientPath).mtimeMs >= statSync(schemaPath).mtimeMs
}

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    throw new Error('Prisma Client not initialized. Call initDatabase() first.')
  }
  return prisma
}

function runMigrations(dbUrl: string): void {
  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 1500

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      execSync('bunx --bun prisma migrate deploy', {
        cwd: PROJECT_ROOT,
        env: { ...process.env, DATABASE_URL: dbUrl },
        stdio: 'inherit',
      })
      return
    } catch (err: any) {
      const isLocked = err?.stderr?.includes('database is locked') ||
        err?.message?.includes('database is locked')
      if (isLocked && attempt < MAX_RETRIES - 1) {
        console.warn(`Database locked during migration, retrying in ${RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${MAX_RETRIES})`)
        Bun.sleepSync(RETRY_DELAY_MS)
        continue
      }
      throw err
    }
  }
}

export async function initDatabase(dbUrl: string): Promise<PrismaClient> {
  if (prisma) {
    return prisma
  }

  process.env.DATABASE_URL = dbUrl
  ensureSqliteFile(dbUrl)

  const dbPath = resolveSqliteFilePath(dbUrl)
  if (dbPath) {
    cleanupWalFiles(dbPath)
  }

  runMigrations(dbUrl)

  if (!isPrismaClientUpToDate()) {
    execSync('bunx --bun prisma generate', {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
    })
  }

  const { PrismaClient: PC } = await import('../generated/prisma/client')
  const adapter = new PrismaLibSql({ url: dbUrl })
  prisma = new PC({ adapter })

  await prisma.$connect()
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;')
  await prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL;')
  await prisma.$executeRawUnsafe('PRAGMA synchronous = NORMAL;')
  await prisma.$executeRawUnsafe('PRAGMA busy_timeout = 5000;')

  return prisma
}

export async function closeDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect()
    prisma = null
  }
}
