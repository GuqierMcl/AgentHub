import { stat } from "node:fs/promises"
import { posix, win32 } from "node:path"

export interface DistributionPaths {
  hubServerBin: string
  runtimeBin: string
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
    hubServerBin: path.join(baseDir, `hub-server${exe}`),
    runtimeBin: path.join(baseDir, `agent-runtime${exe}`),
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
  await assertFile(paths.hubServerBin, "HubServer binary")
  await assertFile(paths.runtimeBin, "Agent Runtime binary")
  await assertDirectory(paths.publicDir, "Web public directory")
}
