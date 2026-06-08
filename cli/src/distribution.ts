import { stat } from "node:fs/promises"
import { posix, win32 } from "node:path"

export interface DistributionPaths {
  bunBin: string
  hubServerEntry: string
  hubServerNodeModulesDir: string
  runtimeEntry: string
  runtimeNodeModulesDir: string
  publicDir: string
}

function pathForPlatform(platform: NodeJS.Platform): typeof posix | typeof win32 {
  return platform === "win32" ? win32 : posix
}

export function resolveDistributionPaths(
  baseDir: string,
  platform: NodeJS.Platform = process.platform,
): DistributionPaths {
  const path = pathForPlatform(platform)
  const exe = platform === "win32" ? ".exe" : ""

  return {
    bunBin: path.join(baseDir, `bun${exe}`),
    hubServerEntry: path.join(baseDir, "hub-server", "index.js"),
    hubServerNodeModulesDir: path.join(baseDir, "hub-server", "node_modules"),
    runtimeEntry: path.join(baseDir, "agent-runtime", "index.js"),
    runtimeNodeModulesDir: path.join(baseDir, "agent-runtime", "node_modules"),
    publicDir: path.join(baseDir, "public"),
  }
}

async function assertFile(path: string, label: string): Promise<void> {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) {
    throw new Error(`Missing ${label}: ${path}`)
  }
}

async function assertDirectory(path: string, label: string): Promise<void> {
  const info = await stat(path).catch(() => null)
  if (!info?.isDirectory()) {
    throw new Error(`Missing ${label}: ${path}`)
  }
}

export async function assertDistributionPaths(paths: DistributionPaths): Promise<void> {
  await assertFile(paths.bunBin, "Bun runtime")
  await assertFile(paths.hubServerEntry, "HubServer bundle")
  await assertDirectory(paths.hubServerNodeModulesDir, "HubServer node_modules directory")
  await assertFile(paths.runtimeEntry, "Agent Runtime bundle")
  await assertDirectory(paths.runtimeNodeModulesDir, "Agent Runtime node_modules directory")
  await assertDirectory(paths.publicDir, "Web public directory")
}
