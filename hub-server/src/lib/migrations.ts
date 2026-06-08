import { closeSync, mkdirSync, openSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Database } from "bun:sqlite"

const PROJECT_ROOT = resolve(import.meta.dir, "..", "..")

export interface SqlMigration {
  name: string
  checksum: string
  sql: string
}

interface AppliedMigrationRow {
  migration_name: string
  checksum: string
}

interface HasApplicationTablesRow {
  has_application_tables: number
}

export interface MigrationResult {
  applied: number
  skipped: number
}

function resolveSqliteFilePath(dbUrl: string): string | null {
  if (!dbUrl.startsWith("file:")) {
    return null
  }

  if (dbUrl.startsWith("file://")) {
    return fileURLToPath(dbUrl)
  }

  const [pathPart] = dbUrl.slice("file:".length).split("?")
  if (!pathPart || pathPart === ":memory:") {
    return null
  }

  return isAbsolute(pathPart) ? pathPart : resolve(PROJECT_ROOT, pathPart)
}

function ensureSqliteFile(dbUrl: string): string {
  const dbPath = resolveSqliteFilePath(dbUrl)
  if (!dbPath) {
    throw new Error(`Production migrations require a file: SQLite database URL: ${dbUrl}`)
  }

  mkdirSync(dirname(dbPath), { recursive: true })
  closeSync(openSync(dbPath, "a"))
  return dbPath
}

function ensureMigrationTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agenthub_schema_migrations (
      migration_name TEXT NOT NULL PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)
}

function readAppliedMigrations(db: Database): Map<string, string> {
  const rows = db
    .query("SELECT migration_name, checksum FROM agenthub_schema_migrations")
    .all() as AppliedMigrationRow[]

  return new Map(rows.map((row) => [row.migration_name, row.checksum]))
}

function hasApplicationTables(db: Database): boolean {
  const row = db.query(`
    SELECT EXISTS(
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT IN ('agenthub_schema_migrations', '_prisma_migrations')
        AND name NOT LIKE 'sqlite_%'
    ) AS has_application_tables
  `).get() as HasApplicationTablesRow | undefined

  return Boolean(row?.has_application_tables)
}

function assertUniqueMigrationNames(migrations: readonly SqlMigration[]): void {
  const seen = new Set<string>()
  for (const migration of migrations) {
    if (seen.has(migration.name)) {
      throw new Error(`Duplicate migration name: ${migration.name}`)
    }
    seen.add(migration.name)
  }
}

function applyMigration(db: Database, migration: SqlMigration): void {
  db.exec("BEGIN IMMEDIATE")
  try {
    db.exec(migration.sql)
    db
      .query(`
        INSERT INTO agenthub_schema_migrations (migration_name, checksum, applied_at)
        VALUES (?, ?, ?)
      `)
      .run(migration.name, migration.checksum, new Date().toISOString())
    db.exec("COMMIT")
  } catch (err) {
    try {
      db.exec("ROLLBACK")
    } catch {
      // The original migration error is more useful to callers.
    }
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to apply migration ${migration.name}: ${message}`)
  }
}

function recordBaselineMigrations(
  db: Database,
  migrations: readonly SqlMigration[],
): MigrationResult {
  db.exec("BEGIN IMMEDIATE")
  try {
    for (const migration of migrations) {
      db
        .query(`
          INSERT INTO agenthub_schema_migrations (migration_name, checksum, applied_at)
          VALUES (?, ?, ?)
        `)
        .run(migration.name, migration.checksum, new Date().toISOString())
    }
    db.exec("COMMIT")
    return { applied: 0, skipped: migrations.length }
  } catch (err) {
    try {
      db.exec("ROLLBACK")
    } catch {
      // The original migration error is more useful to callers.
    }
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to baseline migrations: ${message}`)
  }
}

export function runSqlMigrationsOnDatabase(
  db: Database,
  migrations: readonly SqlMigration[],
): MigrationResult {
  assertUniqueMigrationNames(migrations)
  ensureMigrationTable(db)

  const applied = readAppliedMigrations(db)
  if (applied.size === 0 && hasApplicationTables(db)) {
    return recordBaselineMigrations(db, migrations)
  }

  const result: MigrationResult = { applied: 0, skipped: 0 }

  for (const migration of migrations) {
    const appliedChecksum = applied.get(migration.name)
    if (appliedChecksum) {
      if (appliedChecksum !== migration.checksum) {
        throw new Error(
          `Migration checksum mismatch for ${migration.name}. The database has ${appliedChecksum} but the application has ${migration.checksum}.`,
        )
      }
      result.skipped += 1
      continue
    }

    applyMigration(db, migration)
    applied.set(migration.name, migration.checksum)
    result.applied += 1
  }

  return result
}

export function runProductionMigrations(
  dbUrl: string,
  migrations: readonly SqlMigration[],
): MigrationResult {
  const dbPath = ensureSqliteFile(dbUrl)
  const db = new Database(dbPath)
  try {
    return runSqlMigrationsOnDatabase(db, migrations)
  } finally {
    db.close()
  }
}
