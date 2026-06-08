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
    bunBin: "C:\\Bun\\bun.exe",
    cliBin: "C:\\AgentHub\\cli\\dist\\agenthub-cli.exe",
    hubServerEntry: "C:\\AgentHub\\hub-server\\dist\\index.js",
    hubServerPtySessionHost: "C:\\AgentHub\\hub-server\\dist\\pty-session-host.cjs",
    hubServerNodeModulesDir: "C:\\AgentHub\\hub-server\\node_modules",
    runtimeEntry: "C:\\AgentHub\\agent-runtime\\dist\\index.js",
    runtimeNodeModulesDir: "C:\\AgentHub\\agent-runtime\\node_modules",
    webDistDir: "C:\\AgentHub\\web\\dist",
  },
  outputs: {
    bunBin: "C:\\AgentHub\\dist\\bun.exe",
    cliBin: "C:\\AgentHub\\dist\\agenthub-cli.exe",
    hubServerDir: "C:\\AgentHub\\dist\\hub-server",
    hubServerEntry: "C:\\AgentHub\\dist\\hub-server\\index.js",
    hubServerPtySessionHost: "C:\\AgentHub\\dist\\hub-server\\pty-session-host.cjs",
    hubServerNodeModulesDir: "C:\\AgentHub\\dist\\hub-server\\node_modules",
    runtimeDir: "C:\\AgentHub\\dist\\agent-runtime",
    runtimeEntry: "C:\\AgentHub\\dist\\agent-runtime\\index.js",
    runtimeNodeModulesDir: "C:\\AgentHub\\dist\\agent-runtime\\node_modules",
    publicDir: "C:\\AgentHub\\dist\\public",
  },
}

describe("production package script", () => {
  it("resolves Windows executable paths with .exe suffix", () => {
    expect(resolvePackagePaths("C:\\AgentHub", "win32", "C:\\Bun\\bun.exe")).toEqual(windowsPaths)
  })

  it("resolves POSIX executable paths without .exe suffix", () => {
    expect(resolvePackagePaths("/repo/AgentHub", "linux", "/opt/bun/bin/bun")).toEqual({
      platform: "linux",
      projectRoot: "/repo/AgentHub",
      outputDir: "/repo/AgentHub/dist",
      sources: {
        bunBin: "/opt/bun/bin/bun",
        cliBin: "/repo/AgentHub/cli/dist/agenthub-cli",
        hubServerEntry: "/repo/AgentHub/hub-server/dist/index.js",
        hubServerPtySessionHost: "/repo/AgentHub/hub-server/dist/pty-session-host.cjs",
        hubServerNodeModulesDir: "/repo/AgentHub/hub-server/node_modules",
        runtimeEntry: "/repo/AgentHub/agent-runtime/dist/index.js",
        runtimeNodeModulesDir: "/repo/AgentHub/agent-runtime/node_modules",
        webDistDir: "/repo/AgentHub/web/dist",
      },
      outputs: {
        bunBin: "/repo/AgentHub/dist/bun",
        cliBin: "/repo/AgentHub/dist/agenthub-cli",
        hubServerDir: "/repo/AgentHub/dist/hub-server",
        hubServerEntry: "/repo/AgentHub/dist/hub-server/index.js",
        hubServerPtySessionHost: "/repo/AgentHub/dist/hub-server/pty-session-host.cjs",
        hubServerNodeModulesDir: "/repo/AgentHub/dist/hub-server/node_modules",
        runtimeDir: "/repo/AgentHub/dist/agent-runtime",
        runtimeEntry: "/repo/AgentHub/dist/agent-runtime/index.js",
        runtimeNodeModulesDir: "/repo/AgentHub/dist/agent-runtime/node_modules",
        publicDir: "/repo/AgentHub/dist/public",
      },
    })
  })

  it("fails with a clear error when a required binary is missing", async () => {
    const fs = createFakeFs({
      [windowsPaths.sources.bunBin]: "file",
      [windowsPaths.sources.hubServerEntry]: "file",
      [windowsPaths.sources.hubServerPtySessionHost]: "file",
      [windowsPaths.sources.hubServerNodeModulesDir]: "dir",
      [windowsPaths.sources.runtimeEntry]: "file",
      [windowsPaths.sources.runtimeNodeModulesDir]: "dir",
      [windowsPaths.sources.webDistDir]: "dir",
    })

    await expect(assertPackageInputs(windowsPaths, fs)).rejects.toThrow(
      "Missing CLI binary: C:\\AgentHub\\cli\\dist\\agenthub-cli.exe",
    )
  })

  it("fails with a clear error when web/dist is missing", async () => {
    const fs = createFakeFs({
      [windowsPaths.sources.bunBin]: "file",
      [windowsPaths.sources.cliBin]: "file",
      [windowsPaths.sources.hubServerEntry]: "file",
      [windowsPaths.sources.hubServerPtySessionHost]: "file",
      [windowsPaths.sources.hubServerNodeModulesDir]: "dir",
      [windowsPaths.sources.runtimeEntry]: "file",
      [windowsPaths.sources.runtimeNodeModulesDir]: "dir",
    })

    await expect(assertPackageInputs(windowsPaths, fs)).rejects.toThrow(
      "Missing Web dist directory: C:\\AgentHub\\web\\dist",
    )
  })

  it("assembles a Bun runtime distribution without copying through hub-server/public", async () => {
    const fs = createFakeFs({
      [windowsPaths.sources.bunBin]: "file",
      [windowsPaths.sources.cliBin]: "file",
      [windowsPaths.sources.hubServerEntry]: "file",
      [windowsPaths.sources.hubServerPtySessionHost]: "file",
      [windowsPaths.sources.hubServerNodeModulesDir]: "dir",
      [windowsPaths.sources.runtimeEntry]: "file",
      [windowsPaths.sources.runtimeNodeModulesDir]: "dir",
      [windowsPaths.sources.webDistDir]: "dir",
    })

    await packageAgentHub({ paths: windowsPaths, fs })

    expect(fs.operations).toEqual([
      "rm C:\\AgentHub\\dist recursive=true force=true",
      "mkdir C:\\AgentHub\\dist recursive=true",
      "copyFile C:\\Bun\\bun.exe -> C:\\AgentHub\\dist\\bun.exe",
      "copyFile C:\\AgentHub\\cli\\dist\\agenthub-cli.exe -> C:\\AgentHub\\dist\\agenthub-cli.exe",
      "mkdir C:\\AgentHub\\dist\\hub-server recursive=true",
      "copyFile C:\\AgentHub\\hub-server\\dist\\index.js -> C:\\AgentHub\\dist\\hub-server\\index.js",
      "copyFile C:\\AgentHub\\hub-server\\dist\\pty-session-host.cjs -> C:\\AgentHub\\dist\\hub-server\\pty-session-host.cjs",
      "cp C:\\AgentHub\\hub-server\\node_modules -> C:\\AgentHub\\dist\\hub-server\\node_modules recursive=true",
      "mkdir C:\\AgentHub\\dist\\agent-runtime recursive=true",
      "copyFile C:\\AgentHub\\agent-runtime\\dist\\index.js -> C:\\AgentHub\\dist\\agent-runtime\\index.js",
      "cp C:\\AgentHub\\agent-runtime\\node_modules -> C:\\AgentHub\\dist\\agent-runtime\\node_modules recursive=true",
      "cp C:\\AgentHub\\web\\dist -> C:\\AgentHub\\dist\\public recursive=true",
    ])
    expect(fs.operations.join("\n")).not.toContain("hub-server\\public")
  })
})
