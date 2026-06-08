import { describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { join } from "node:path"
import {
  readPrismaMigrations,
  renderMigrationManifest,
  writeMigrationManifest,
} from "./migration-manifest"

describe("migration manifest generation", () => {
  it("reads Prisma migration.sql files in stable name order with checksums", async () => {
    const root = await mkdtemp(join(tmpdir(), "agenthub-migrations-"))
    await mkdir(join(root, "20240202000000_second"))
    await mkdir(join(root, "20240101000000_first"))
    await writeFile(join(root, "20240202000000_second", "migration.sql"), "CREATE TABLE second(id TEXT);")
    await writeFile(join(root, "20240101000000_first", "migration.sql"), "CREATE TABLE first(id TEXT);")

    const migrations = await readPrismaMigrations(root)

    expect(migrations.map((migration) => migration.name)).toEqual([
      "20240101000000_first",
      "20240202000000_second",
    ])
    expect(migrations[0].checksum).toBe(
      createHash("sha256").update("CREATE TABLE first(id TEXT);").digest("hex"),
    )
  })

  it("renders a TypeScript migration manifest", () => {
    const source = renderMigrationManifest([
      {
        name: "20240101000000_first",
        checksum: "abc123",
        sql: "CREATE TABLE first(id TEXT);\nINSERT INTO first VALUES ('a');",
      },
    ])

    expect(source).toContain("import type { SqlMigration } from '../lib/migrations'")
    expect(source).toContain("export const PRISMA_MIGRATIONS")
    expect(source).toContain("20240101000000_first")
    expect(source).toContain("CREATE TABLE first")
  })

  it("writes the generated manifest file", async () => {
    const root = await mkdtemp(join(tmpdir(), "agenthub-manifest-"))
    const migrationsDir = join(root, "migrations")
    const outputFile = join(root, "src", "generated", "prisma-migrations.ts")
    await mkdir(join(migrationsDir, "20240101000000_first"), { recursive: true })
    await writeFile(join(migrationsDir, "20240101000000_first", "migration.sql"), "CREATE TABLE first(id TEXT);")

    await writeMigrationManifest({ migrationsDir, outputFile })

    const source = await readFile(outputFile, "utf8")
    expect(source).toContain("20240101000000_first")
    expect(source).toContain("CREATE TABLE first")
  })
})
