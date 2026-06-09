import { describe, expect, it } from "bun:test"
import { Database } from "bun:sqlite"
import { runSqlMigrationsOnDatabase, type SqlMigration } from "./migrations"

function queryOne<T>(db: Database, sql: string): T {
  return db.query(sql).get() as T
}

describe("SQL migration runner", () => {
  it("applies pending migrations in order and records them", () => {
    const db = new Database(":memory:")
    const migrations: SqlMigration[] = [
      {
        name: "001_create_items",
        checksum: "sha-001",
        sql: "CREATE TABLE items(id TEXT PRIMARY KEY); INSERT INTO items(id) VALUES ('a');",
      },
      {
        name: "002_create_notes",
        checksum: "sha-002",
        sql: "CREATE TABLE notes(id TEXT PRIMARY KEY);",
      },
    ]

    const result = runSqlMigrationsOnDatabase(db, migrations)

    expect(result).toEqual({ applied: 2, skipped: 0 })
    expect(queryOne<{ count: number }>(db, "SELECT COUNT(*) AS count FROM items").count).toBe(1)
    expect(
      queryOne<{ count: number }>(
        db,
        "SELECT COUNT(*) AS count FROM agenthub_schema_migrations",
      ).count,
    ).toBe(2)
    db.close()
  })

  it("skips migrations that were already applied with the same checksum", () => {
    const db = new Database(":memory:")
    const migrations: SqlMigration[] = [
      {
        name: "001_create_items",
        checksum: "sha-001",
        sql: "CREATE TABLE items(id TEXT PRIMARY KEY);",
      },
    ]

    expect(runSqlMigrationsOnDatabase(db, migrations)).toEqual({ applied: 1, skipped: 0 })
    expect(runSqlMigrationsOnDatabase(db, migrations)).toEqual({ applied: 0, skipped: 1 })
    db.close()
  })

  it("accepts compatible legacy checksums and upgrades them to the canonical checksum", () => {
    const db = new Database(":memory:")
    db.exec(`
      CREATE TABLE agenthub_schema_migrations (
        migration_name TEXT NOT NULL PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO agenthub_schema_migrations (migration_name, checksum, applied_at)
      VALUES ('001_create_items', 'legacy-crlf-sha', '2026-06-08T09:36:51.518Z');
    `)

    const result = runSqlMigrationsOnDatabase(db, [
      {
        name: "001_create_items",
        checksum: "canonical-lf-sha",
        compatibleChecksums: ["legacy-crlf-sha"],
        sql: "CREATE TABLE items(id TEXT PRIMARY KEY);",
      },
    ])

    expect(result).toEqual({ applied: 0, skipped: 1 })
    expect(
      queryOne<{ checksum: string }>(
        db,
        "SELECT checksum FROM agenthub_schema_migrations WHERE migration_name = '001_create_items'",
      ).checksum,
    ).toBe("canonical-lf-sha")
    db.close()
  })

  it("fails when an applied migration checksum changes", () => {
    const db = new Database(":memory:")
    runSqlMigrationsOnDatabase(db, [
      {
        name: "001_create_items",
        checksum: "sha-001",
        sql: "CREATE TABLE items(id TEXT PRIMARY KEY);",
      },
    ])

    expect(() => runSqlMigrationsOnDatabase(db, [
      {
        name: "001_create_items",
        checksum: "sha-edited",
        sql: "CREATE TABLE items(id TEXT PRIMARY KEY);",
      },
    ])).toThrow(
      "Migration checksum mismatch for 001_create_items. The database has sha-001 but the application has sha-edited.",
    )
    db.close()
  })

  it("rolls back a failed migration transaction", () => {
    const db = new Database(":memory:")

    expect(() => runSqlMigrationsOnDatabase(db, [
      {
        name: "001_create_items",
        checksum: "sha-001",
        sql: "CREATE TABLE items(id TEXT PRIMARY KEY);",
      },
      {
        name: "002_broken",
        checksum: "sha-002",
        sql: "CREATE TABLE broken(",
      },
    ])).toThrow("Failed to apply migration 002_broken")

    expect(
      queryOne<{ count: number }>(
        db,
        "SELECT COUNT(*) AS count FROM agenthub_schema_migrations",
      ).count,
    ).toBe(1)
    db.close()
  })

  it("baselines an existing database when migration history is empty", () => {
    const db = new Database(":memory:")
    db.exec("CREATE TABLE conversations(id TEXT PRIMARY KEY);")

    const migrations: SqlMigration[] = [
      {
        name: "001_create_items",
        checksum: "sha-001",
        sql: "CREATE TABLE conversations(id TEXT PRIMARY KEY);",
      },
      {
        name: "002_create_notes",
        checksum: "sha-002",
        sql: "CREATE TABLE notes(id TEXT PRIMARY KEY);",
      },
    ]

    const result = runSqlMigrationsOnDatabase(db, migrations)

    expect(result).toEqual({ applied: 0, skipped: 2 })
    expect(
      queryOne<{ count: number }>(
        db,
        "SELECT COUNT(*) AS count FROM agenthub_schema_migrations",
      ).count,
    ).toBe(2)
    db.close()
  })
})
