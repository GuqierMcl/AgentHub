import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'prisma/config'

const defaultDatabaseUrl = 'file:./prisma/data-tmp/dev.db'
const databaseUrl = process.env.DATABASE_URL ?? defaultDatabaseUrl
const configRoot = dirname(fileURLToPath(import.meta.url))

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

  return isAbsolute(pathPart) ? pathPart : resolve(configRoot, pathPart)
}

function ensureSqliteFile(dbUrl: string): void {
  const dbPath = resolveSqliteFilePath(dbUrl)
  if (!dbPath) {
    return
  }

  if (existsSync(dbPath)) {
    return
  }

  mkdirSync(dirname(dbPath), { recursive: true })
  closeSync(openSync(dbPath, 'a'))
}

ensureSqliteFile(databaseUrl)

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
})
