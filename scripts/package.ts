import type { Stats } from "node:fs"
import { chmod, copyFile, cp, mkdir, rm, stat } from "node:fs/promises"
import { dirname, posix, resolve, win32 } from "node:path"
import { fileURLToPath } from "node:url"

export interface PackagePaths {
  platform: NodeJS.Platform
  projectRoot: string
  outputDir: string
  sources: {
    bunBin: string
    cliBin: string
    hubServerEntry: string
    hubServerPtySessionHost: string
    hubServerNodeModulesDir: string
    runtimeEntry: string
    runtimeNodeModulesDir: string
    webDistDir: string
  }
  outputs: {
    bunBin: string
    cliBin: string
    hubServerDir: string
    hubServerEntry: string
    hubServerPtySessionHost: string
    hubServerNodeModulesDir: string
    runtimeDir: string
    runtimeEntry: string
    runtimeNodeModulesDir: string
    publicDir: string
  }
}

export interface PackageFileSystem {
  stat(path: string): Promise<Pick<Stats, "isFile" | "isDirectory">>
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>
  mkdir(path: string, options: { recursive: boolean }): Promise<void>
  copyFile(source: string, destination: string): Promise<void>
  cp(source: string, destination: string, options: { recursive: boolean }): Promise<void>
  chmod(path: string, mode: number): Promise<void>
}

const defaultFs: PackageFileSystem = {
  stat,
  rm,
  mkdir,
  copyFile,
  cp,
  chmod,
}

function pathForPlatform(platform: NodeJS.Platform): typeof posix | typeof win32 {
  return platform === "win32" ? win32 : posix
}

export function resolvePackagePaths(
  projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  platform: NodeJS.Platform = process.platform,
  bunBin = process.execPath,
): PackagePaths {
  const path = pathForPlatform(platform)
  const exe = platform === "win32" ? ".exe" : ""
  const outputDir = path.join(projectRoot, "dist")

  return {
    platform,
    projectRoot,
    outputDir,
    sources: {
      bunBin,
      cliBin: path.join(projectRoot, "cli", "dist", `agenthub-cli${exe}`),
      hubServerEntry: path.join(projectRoot, "hub-server", "dist", "index.js"),
      hubServerPtySessionHost: path.join(projectRoot, "hub-server", "dist", "pty-session-host.cjs"),
      hubServerNodeModulesDir: path.join(projectRoot, "hub-server", "node_modules"),
      runtimeEntry: path.join(projectRoot, "agent-runtime", "dist", "index.js"),
      runtimeNodeModulesDir: path.join(projectRoot, "agent-runtime", "node_modules"),
      webDistDir: path.join(projectRoot, "web", "dist"),
    },
    outputs: {
      bunBin: path.join(outputDir, `bun${exe}`),
      cliBin: path.join(outputDir, `agenthub-cli${exe}`),
      hubServerDir: path.join(outputDir, "hub-server"),
      hubServerEntry: path.join(outputDir, "hub-server", "index.js"),
      hubServerPtySessionHost: path.join(outputDir, "hub-server", "pty-session-host.cjs"),
      hubServerNodeModulesDir: path.join(outputDir, "hub-server", "node_modules"),
      runtimeDir: path.join(outputDir, "agent-runtime"),
      runtimeEntry: path.join(outputDir, "agent-runtime", "index.js"),
      runtimeNodeModulesDir: path.join(outputDir, "agent-runtime", "node_modules"),
      publicDir: path.join(outputDir, "public"),
    },
  }
}

async function assertFile(
  fs: PackageFileSystem,
  path: string,
  label: string,
): Promise<void> {
  const info = await fs.stat(path).catch(() => null)
  if (!info?.isFile()) {
    throw new Error(`Missing ${label}: ${path}`)
  }
}

async function assertDirectory(
  fs: PackageFileSystem,
  path: string,
  label: string,
): Promise<void> {
  const info = await fs.stat(path).catch(() => null)
  if (!info?.isDirectory()) {
    throw new Error(`Missing ${label}: ${path}`)
  }
}

export async function assertPackageInputs(
  paths: PackagePaths,
  fs: PackageFileSystem = defaultFs,
): Promise<void> {
  await assertFile(fs, paths.sources.bunBin, "Bun runtime")
  await assertFile(fs, paths.sources.cliBin, "CLI binary")
  await assertFile(fs, paths.sources.hubServerEntry, "HubServer bundle")
  await assertFile(fs, paths.sources.hubServerPtySessionHost, "HubServer PTY session helper")
  await assertDirectory(fs, paths.sources.hubServerNodeModulesDir, "HubServer node_modules directory")
  await assertFile(fs, paths.sources.runtimeEntry, "Agent Runtime bundle")
  await assertDirectory(fs, paths.sources.runtimeNodeModulesDir, "Agent Runtime node_modules directory")
  await assertDirectory(fs, paths.sources.webDistDir, "Web dist directory")
}

export async function packageAgentHub(options: {
  paths?: PackagePaths
  fs?: PackageFileSystem
} = {}): Promise<PackagePaths> {
  const paths = options.paths ?? resolvePackagePaths()
  const fs = options.fs ?? defaultFs

  await assertPackageInputs(paths, fs)
  await fs.rm(paths.outputDir, { recursive: true, force: true })
  await fs.mkdir(paths.outputDir, { recursive: true })
  await fs.copyFile(paths.sources.bunBin, paths.outputs.bunBin)
  await fs.copyFile(paths.sources.cliBin, paths.outputs.cliBin)
  await fs.mkdir(paths.outputs.hubServerDir, { recursive: true })
  await fs.copyFile(paths.sources.hubServerEntry, paths.outputs.hubServerEntry)
  await fs.copyFile(paths.sources.hubServerPtySessionHost, paths.outputs.hubServerPtySessionHost)
  await fs.cp(paths.sources.hubServerNodeModulesDir, paths.outputs.hubServerNodeModulesDir, { recursive: true })
  await fs.mkdir(paths.outputs.runtimeDir, { recursive: true })
  await fs.copyFile(paths.sources.runtimeEntry, paths.outputs.runtimeEntry)
  await fs.cp(paths.sources.runtimeNodeModulesDir, paths.outputs.runtimeNodeModulesDir, { recursive: true })
  await fs.cp(paths.sources.webDistDir, paths.outputs.publicDir, { recursive: true })

  if (paths.platform !== "win32") {
    await fs.chmod(paths.outputs.bunBin, 0o755)
    await fs.chmod(paths.outputs.cliBin, 0o755)
  }

  return paths
}

if (import.meta.main) {
  packageAgentHub()
    .then((paths) => {
      console.log(`AgentHub package assembled at ${paths.outputDir}`)
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
}
