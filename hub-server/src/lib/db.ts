import { PrismaLibSql } from '@prisma/adapter-libsql'
import { execSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PrismaClient } from '../generated/prisma/client'
import { logger } from './logger'

let prisma: PrismaClient | null = null

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..')

interface InitDatabaseOptions {
  allowPrismaGenerate?: boolean
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

export async function initDatabase(dbUrl: string, options: InitDatabaseOptions = {}): Promise<PrismaClient> {
  if (prisma) {
    return prisma
  }

  const allowPrismaGenerate = options.allowPrismaGenerate ?? true
  process.env.DATABASE_URL = dbUrl
  ensureSqliteFile(dbUrl)

  if (!isPrismaClientUpToDate()) {
    if (!allowPrismaGenerate) {
      throw new Error(
        'Prisma Client is missing or older than schema. Generate Prisma Client during the build before starting Hub Server in production.',
      )
    }

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
    try {
      await prisma.$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);')
    } catch (err) {
      logger.warn({ err }, 'SQLite WAL checkpoint during shutdown failed')
    } finally {
      await prisma.$disconnect()
      prisma = null
    }
  }
}
