import type { PrismaClient } from '@prisma/client'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

let prisma: PrismaClient | null = null

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..')

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

  execSync('bunx prisma migrate deploy', {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'inherit',
  })

  execSync('bunx prisma generate', {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  })

  const { PrismaClient: PC } = await import('@prisma/client')
  prisma = new PC()

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