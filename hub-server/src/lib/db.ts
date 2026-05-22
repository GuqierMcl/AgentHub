import { PrismaClient } from '@prisma/client'

let prisma: PrismaClient | null = null

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

  prisma = new PrismaClient()

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