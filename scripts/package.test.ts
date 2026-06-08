import { describe, expect, it } from "bun:test"
import {
  assertPackageInputs,
  packageAgentHub,
  resolvePackagePaths,
  type PackageFileSystem,
  type PackagePaths,
} from "./package"

function createFakeFs(entries: Record<string, "file" | "dir">): PackageFileSystem & {
  operations: string[]
} {
  const operations: string[] = []
  return {
    operations,
    async stat(path) {
      const entry = entries[path]
      if (!entry) {
        throw new Error("ENOENT")
      }
      return {
        isFile: () => entry === "file",
        isDirectory: () => entry === "dir",
      }
    },
    async rm(path, options) {
      operations.push(`rm ${path} recursive=${String(options.recursive)} force=${String(options.force)}`)
    },
    async mkdir(path, options) {
      operations.push(`mkdir ${path} recursive=${String(options.recursive)}`)
    },
    async copyFile(source, destination) {
      operations.push(`copyFile ${source} -> ${destination}`)
    },
    async cp(source, destination, options) {
      operations.push(`cp ${source} -> ${destination} recursive=${String(options.recursive)}`)
    },
    async chmod(path, mode) {
      operations.push(`chmod ${path} ${mode.toString(8)}`)
    },
  }
}

const windowsPaths: PackagePaths = {
  platform: "win32",
  projectRoot: "C:\\AgentHub",
  outputDir: "C:\\AgentHub\\dist",
  sources: {
    cliBin: "C:\\AgentHub\\cli\\dist\\agenthub-cli.exe",
    hubServerBin: "C:\\AgentHub\\hub-server\\dist\\hub-server.exe",
    runtimeBin: "C:\\AgentHub\\agent-runtime\\dist\\agent-runtime.exe",
    webDistDir: "C:\\AgentHub\\web\\dist",
  },
  outputs: {
    cliBin: "C:\\AgentHub\\dist\\agenthub-cli.exe",
    hubServerBin: "C:\\AgentHub\\dist\\hub-server.exe",
    runtimeBin: "C:\\AgentHub\\dist\\agent-runtime.exe",
    publicDir: "C:\\AgentHub\\dist\\public",
  },
}

describe("production package script", () => {
  it("resolves Windows executable paths with .exe suffix", () => {
    expect(resolvePackagePaths("C:\\AgentHub", "win32")).toEqual(windowsPaths)
  })

  it("resolves POSIX executable paths without .exe suffix", () => {
    expect(resolvePackagePaths("/repo/AgentHub", "linux")).toEqual({
      platform: "linux",
      projectRoot: "/repo/AgentHub",
      outputDir: "/repo/AgentHub/dist",
      sources: {
        cliBin: "/repo/AgentHub/cli/dist/agenthub-cli",
        hubServerBin: "/repo/AgentHub/hub-server/dist/hub-server",
        runtimeBin: "/repo/AgentHub/agent-runtime/dist/agent-runtime",
        webDistDir: "/repo/AgentHub/web/dist",
      },
      outputs: {
        cliBin: "/repo/AgentHub/dist/agenthub-cli",
        hubServerBin: "/repo/AgentHub/dist/hub-server",
        runtimeBin: "/repo/AgentHub/dist/agent-runtime",
        publicDir: "/repo/AgentHub/dist/public",
      },
    })
  })

  it("fails with a clear error when a required binary is missing", async () => {
    const fs = createFakeFs({
      [windowsPaths.sources.hubServerBin]: "file",
      [windowsPaths.sources.runtimeBin]: "file",
      [windowsPaths.sources.webDistDir]: "dir",
    })

    await expect(assertPackageInputs(windowsPaths, fs)).rejects.toThrow(
      "Missing CLI binary: C:\\AgentHub\\cli\\dist\\agenthub-cli.exe",
    )
  })

  it("fails with a clear error when web/dist is missing", async () => {
    const fs = createFakeFs({
      [windowsPaths.sources.cliBin]: "file",
      [windowsPaths.sources.hubServerBin]: "file",
      [windowsPaths.sources.runtimeBin]: "file",
    })

    await expect(assertPackageInputs(windowsPaths, fs)).rejects.toThrow(
      "Missing Web dist directory: C:\\AgentHub\\web\\dist",
    )
  })

  it("assembles a flat distribution without copying through hub-server/public", async () => {
    const fs = createFakeFs({
      [windowsPaths.sources.cliBin]: "file",
      [windowsPaths.sources.hubServerBin]: "file",
      [windowsPaths.sources.runtimeBin]: "file",
      [windowsPaths.sources.webDistDir]: "dir",
    })

    await packageAgentHub({ paths: windowsPaths, fs })

    expect(fs.operations).toEqual([
      "rm C:\\AgentHub\\dist recursive=true force=true",
      "mkdir C:\\AgentHub\\dist recursive=true",
      "copyFile C:\\AgentHub\\cli\\dist\\agenthub-cli.exe -> C:\\AgentHub\\dist\\agenthub-cli.exe",
      "copyFile C:\\AgentHub\\hub-server\\dist\\hub-server.exe -> C:\\AgentHub\\dist\\hub-server.exe",
      "copyFile C:\\AgentHub\\agent-runtime\\dist\\agent-runtime.exe -> C:\\AgentHub\\dist\\agent-runtime.exe",
      "cp C:\\AgentHub\\web\\dist -> C:\\AgentHub\\dist\\public recursive=true",
    ])
    expect(fs.operations.join("\n")).not.toContain("hub-server\\public")
  })
})
