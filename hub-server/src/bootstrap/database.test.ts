import { describe, expect, it } from "bun:test"
import {
  bootstrapDatabase,
  isProductionDatabaseMode,
  type DatabaseBootstrapConfig,
} from "./database"

const devConfig: DatabaseBootstrapConfig = {
  dbUrl: "file:C:/AgentHub/hub.db",
  env: "development",
}

describe("database bootstrap", () => {
  it("treats managed sidecar startup as production database mode", () => {
    expect(isProductionDatabaseMode({
      ...devConfig,
      runtimeBin: "C:/AgentHub/agent-runtime.exe",
    })).toBe(true)
  })

  it("treats runtime-entry sidecar startup as production database mode", () => {
    expect(isProductionDatabaseMode({
      ...devConfig,
      runtimeEntry: "C:/AgentHub/agent-runtime/index.js",
    })).toBe(true)
  })

  it("treats NODE_ENV production as production database mode", () => {
    expect(isProductionDatabaseMode({
      ...devConfig,
      env: "production",
    })).toBe(true)
  })

  it("keeps manual development startup in development database mode", () => {
    expect(isProductionDatabaseMode(devConfig)).toBe(false)
  })

  it("runs production migrations before initializing Prisma Client", async () => {
    const calls: string[] = []

    await bootstrapDatabase({
      config: {
        ...devConfig,
        runtimeBin: "C:/AgentHub/agent-runtime.exe",
      },
      migrations: [],
      runMigrations: (dbUrl) => {
        calls.push(`migrate ${dbUrl}`)
        return { applied: 1, skipped: 2 }
      },
      initDatabase: async (_dbUrl, options) => {
        calls.push(`init allowGenerate=${String(options.allowPrismaGenerate)}`)
      },
      logger: {
        info: () => {},
      },
    })

    expect(calls).toEqual([
      "migrate file:C:/AgentHub/hub.db",
      "init allowGenerate=false",
    ])
  })

  it("skips production migrations and allows Prisma generate in manual development mode", async () => {
    const calls: string[] = []

    await bootstrapDatabase({
      config: devConfig,
      migrations: [],
      runMigrations: () => {
        calls.push("migrate")
        return { applied: 0, skipped: 0 }
      },
      initDatabase: async (_dbUrl, options) => {
        calls.push(`init allowGenerate=${String(options.allowPrismaGenerate)}`)
      },
      logger: {
        info: () => {},
      },
    })

    expect(calls).toEqual(["init allowGenerate=true"])
  })
})
