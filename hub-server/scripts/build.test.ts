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

  it("generates Prisma Client before compiling HubServer", () => {
    expect(createHubBuildCommands()).toEqual([
      ["bunx", "--bun", "prisma", "generate"],
      ["bun", "build", "src/index.ts", "--compile", "--outfile", "dist/hub-server"],
    ])
  })

  it("validates web/dist and runs only HubServer build commands", async () => {
    const commands: string[][] = []

    await runHubServerBuild({
      paths,
      stat: async () => directoryStat(),
      runCommand: async (command) => {
        commands.push(command)
      },
    })

    expect(commands).toEqual(createHubBuildCommands())
    expect(commands.map((command) => command.join(" ")).join("\n")).not.toContain("hub-server/public")
  })
})
