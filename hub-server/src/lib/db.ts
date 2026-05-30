import { PrismaLibSql } from '@prisma/adapter-libsql'
import { execSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
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

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    throw new Error('Prisma Client not initialized. Call initDatabase() first.')
  }
  return prisma
}

export async function initDatabase(dbUrl: string): Promise<PrismaClient> {
  if (prisma) {
    return prisma
  }

  process.env.DATABASE_URL = dbUrl
  ensureSqliteFile(dbUrl)

  execSync('bunx --bun prisma migrate deploy', {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'inherit',
  })

  execSync('bunx --bun prisma generate', {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  })

  const { PrismaClient: PC } = await import('../generated/prisma/client')
  const adapter = new PrismaLibSql({ url: dbUrl })
  prisma = new PC({ adapter })

  await prisma.$connect()
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;')

  return prisma
}

export async function closeDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect()
    prisma = null
  }
}
