import { describe, expect, it } from "bun:test"
import {
  assertWebDistExists,
  createHubBuildCommands,
  runHubServerBuild,
  type HubBuildPaths,
} from "./build"

const paths: HubBuildPaths = {
  hubRoot: "C:\\AgentHub\\hub-server",
  projectRoot: "C:\\AgentHub",
  webDistDir: "C:\\AgentHub\\web\\dist",
  migrationsDir: "C:\\AgentHub\\hub-server\\prisma\\migrations",
  migrationManifestFile: "C:\\AgentHub\\hub-server\\src\\generated\\prisma-migrations.ts",
}

function directoryStat() {
  return {
    isDirectory: () => true,
  }
}

function fileStat() {
  return {
    isDirectory: () => false,
  }
}

describe("hub-server production build script", () => {
  it("fails when web/dist is missing", async () => {
    await expect(assertWebDistExists(paths.webDistDir, async () => {
      throw new Error("ENOENT")
    })).rejects.toThrow(
      'Missing Web dist: C:\\AgentHub\\web\\dist. Run "bun run build:web" before "bun run build:hub".',
    )
  })

  it("requires web/dist to be a directory", async () => {
    await expect(assertWebDistExists(paths.webDistDir, async () => fileStat())).rejects.toThrow(
      "Web dist is not a directory: C:\\AgentHub\\web\\dist",
    )
  })

  it("generates Prisma Client before bundling HubServer", () => {
    expect(createHubBuildCommands()).toEqual([
      ["bunx", "--bun", "prisma", "generate"],
      [
        "bun",
        "build",
        "src/index.ts",
        "--target",
        "bun",
        "--outdir",
        "dist",
        "--external",
        "sharp",
        "--external",
        "@libsql/client",
        "--external",
        "libsql",
        "--external",
        "node-pty",
      ],
    ])
  })

  it("generates the migration manifest before running HubServer build commands", async () => {
    const operations: string[] = []

    await runHubServerBuild({
      paths,
      stat: async () => directoryStat(),
      writeMigrationManifest: async (options) => {
        operations.push(`manifest ${options.migrationsDir} -> ${options.outputFile}`)
      },
      runCommand: async (command) => {
        operations.push(`command ${command.join(" ")}`)
      },
    })

    expect(operations).toEqual([
      "manifest C:\\AgentHub\\hub-server\\prisma\\migrations -> C:\\AgentHub\\hub-server\\src\\generated\\prisma-migrations.ts",
      "command bunx --bun prisma generate",
      "command bun build src/index.ts --target bun --outdir dist --external sharp --external @libsql/client --external libsql --external node-pty",
    ])
    expect(operations.join("\n")).not.toContain("hub-server/public")
  })
})
