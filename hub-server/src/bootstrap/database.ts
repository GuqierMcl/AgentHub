import type { HubConfig } from "../config"
import { PRISMA_MIGRATIONS } from "../generated/prisma-migrations"
import { initDatabase as defaultInitDatabase } from "../lib/db"
import {
  runProductionMigrations as defaultRunProductionMigrations,
  type MigrationResult,
  type SqlMigration,
} from "../lib/migrations"
import { logger as defaultLogger } from "../lib/logger"

export type DatabaseBootstrapConfig = Pick<HubConfig, "dbUrl" | "runtimeBin" | "runtimeEntry" | "env">

type InitDatabase = (
  dbUrl: string,
  options: { allowPrismaGenerate: boolean },
) => Promise<unknown>

type RunMigrations = (
  dbUrl: string,
  migrations: readonly SqlMigration[],
) => MigrationResult

interface DatabaseBootstrapLogger {
  info(payload: unknown, message?: string): void
}

export function isProductionDatabaseMode(config: DatabaseBootstrapConfig): boolean {
  return Boolean(config.runtimeEntry) || Boolean(config.runtimeBin) || config.env === "production"
}

export async function bootstrapDatabase(options: {
  config: DatabaseBootstrapConfig
  migrations?: readonly SqlMigration[]
  runMigrations?: RunMigrations
  initDatabase?: InitDatabase
  logger?: DatabaseBootstrapLogger
}): Promise<void> {
  const productionMode = isProductionDatabaseMode(options.config)
  const initDatabase = options.initDatabase ?? defaultInitDatabase

  if (productionMode) {
    const runMigrations = options.runMigrations ?? defaultRunProductionMigrations
    const migrations = options.migrations ?? PRISMA_MIGRATIONS
    const result = runMigrations(options.config.dbUrl, migrations)
    const logger = options.logger ?? defaultLogger
    logger.info({
      applied: result.applied,
      skipped: result.skipped,
    }, "Database migrations checked")
  }

  await initDatabase(options.config.dbUrl, {
    allowPrismaGenerate: !productionMode,
  })
}
