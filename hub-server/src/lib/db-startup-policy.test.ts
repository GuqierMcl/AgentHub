import { describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { shouldRunPrismaGenerate } from './db'

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..')

describe('database startup policy', () => {
  it('runs migrations before starting the development server', async () => {
    const packageJson = JSON.parse(
      await readFile(join(PROJECT_ROOT, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }

    expect(packageJson.scripts?.dev).toStartWith('bun run dev:migrate && ')
    expect(packageJson.scripts?.dev).toContain('bun run --hot src/index.ts')
    expect(packageJson.scripts?.['dev:migrate']).toBe(
      'bun run scripts/migrate-dev-database.ts',
    )
  })

  it('does not run Prisma migration CLI from application initialization', async () => {
    const dbSource = await readFile(join(import.meta.dir, 'db.ts'), 'utf8')

    expect(dbSource).not.toContain('prisma migrate deploy')
    expect(dbSource).not.toContain('bunx --bun prisma migrate deploy')
  })

  it('makes Prisma Client generation opt-in for application initialization', async () => {
    const dbSource = await readFile(join(import.meta.dir, 'db.ts'), 'utf8')

    expect(dbSource).toContain('allowPrismaGenerate')
    expect(dbSource).toContain('Prisma Client is missing or older than schema')
  })

  it('does not require source generated Prisma files when generation is disabled', () => {
    expect(shouldRunPrismaGenerate({
      allowPrismaGenerate: false,
      clientExists: false,
      schemaExists: false,
      clientMtimeMs: 0,
      schemaMtimeMs: 0,
    })).toBe(false)
  })

  it('injects the Hub Server database URL for development migrations', async () => {
    const migrationScriptSource = await readFile(
      join(PROJECT_ROOT, 'scripts', 'migrate-dev-database.ts'),
      'utf8',
    )

    expect(migrationScriptSource).toContain('AGENTHUB_DATA_DIR')
    expect(migrationScriptSource).toContain('DATABASE_URL')
    expect(migrationScriptSource).toContain('hub.db')
    expect(migrationScriptSource).toContain('prisma:migrate:deploy')
  })
})
