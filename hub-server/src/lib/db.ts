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

export interface PrismaGenerateDecisionInput {
  allowPrismaGenerate: boolean
  clientExists: boolean
  schemaExists: boolean
  clientMtimeMs: number
  schemaMtimeMs: number
}

export function shouldRunPrismaGenerate(input: PrismaGenerateDecisionInput): boolean {
  if (!input.allowPrismaGenerate) {
    return false
  }

  if (!input.clientExists || !input.schemaExists) {
    return true
  }

  return input.clientMtimeMs < input.schemaMtimeMs
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

function getPrismaGenerateFileState(): Omit<PrismaGenerateDecisionInput, 'allowPrismaGenerate'> {
  const schemaPath = resolve(PROJECT_ROOT, 'prisma', 'schema.prisma')
  const clientPath = resolve(PROJECT_ROOT, 'src', 'generated', 'prisma', 'client.ts')

  const clientExists = existsSync(clientPath)
  const schemaExists = existsSync(schemaPath)

  return {
    clientExists,
    schemaExists,
    clientMtimeMs: clientExists ? statSync(clientPath).mtimeMs : 0,
    schemaMtimeMs: schemaExists ? statSync(schemaPath).mtimeMs : 0,
  }
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

  if (shouldRunPrismaGenerate({
    allowPrismaGenerate,
    ...getPrismaGenerateFileState(),
  })) {
    execSync('bunx --bun prisma generate', {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
    })
  }

  let PC: typeof import('../generated/prisma/client').PrismaClient
  try {
    const generatedClient = await import('../generated/prisma/client')
    PC = generatedClient.PrismaClient
  } catch (err) {
    if (!allowPrismaGenerate) {
      throw new Error(
        'Prisma Client is missing or older than schema. Generate Prisma Client during the build before starting Hub Server in production.',
      )
    }
    throw err
  }

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
