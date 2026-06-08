import type { Stats } from "node:fs"
import { chmod, copyFile, cp, mkdir, rm, stat } from "node:fs/promises"
import { dirname, posix, resolve, win32 } from "node:path"
import { fileURLToPath } from "node:url"

export interface PackagePaths {
  platform: NodeJS.Platform
  projectRoot: string
  outputDir: string
  sources: {
    cliBin: string
    hubServerBin: string
    runtimeBin: string
    webDistDir: string
  }
  outputs: {
    cliBin: string
    hubServerBin: string
    runtimeBin: string
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
): PackagePaths {
  const path = pathForPlatform(platform)
  const exe = platform === "win32" ? ".exe" : ""
  const outputDir = path.join(projectRoot, "dist")

  return {
    platform,
    projectRoot,
    outputDir,
    sources: {
      cliBin: path.join(projectRoot, "cli", "dist", `agenthub-cli${exe}`),
      hubServerBin: path.join(projectRoot, "hub-server", "dist", `hub-server${exe}`),
      runtimeBin: path.join(projectRoot, "agent-runtime", "dist", `agent-runtime${exe}`),
      webDistDir: path.join(projectRoot, "web", "dist"),
    },
    outputs: {
      cliBin: path.join(outputDir, `agenthub-cli${exe}`),
      hubServerBin: path.join(outputDir, `hub-server${exe}`),
      runtimeBin: path.join(outputDir, `agent-runtime${exe}`),
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
  await assertFile(fs, paths.sources.cliBin, "CLI binary")
  await assertFile(fs, paths.sources.hubServerBin, "HubServer binary")
  await assertFile(fs, paths.sources.runtimeBin, "Agent Runtime binary")
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
  await fs.copyFile(paths.sources.cliBin, paths.outputs.cliBin)
  await fs.copyFile(paths.sources.hubServerBin, paths.outputs.hubServerBin)
  await fs.copyFile(paths.sources.runtimeBin, paths.outputs.runtimeBin)
  await fs.cp(paths.sources.webDistDir, paths.outputs.publicDir, { recursive: true })

  if (paths.platform !== "win32") {
    await fs.chmod(paths.outputs.cliBin, 0o755)
    await fs.chmod(paths.outputs.hubServerBin, 0o755)
    await fs.chmod(paths.outputs.runtimeBin, 0o755)
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
