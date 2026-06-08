import type { Stats } from "node:fs"
import { stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export interface HubBuildPaths {
  hubRoot: string
  projectRoot: string
  webDistDir: string
}

export type StatFile = (path: string) => Promise<Pick<Stats, "isDirectory">>

export type RunCommand = (
  command: string[],
  options: { cwd: string },
) => Promise<void>

export function resolveHubBuildPaths(
  hubRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
): HubBuildPaths {
  const projectRoot = resolve(hubRoot, "..")
  return {
    hubRoot,
    projectRoot,
    webDistDir: resolve(projectRoot, "web", "dist"),
  }
}

export async function assertWebDistExists(
  webDistDir: string,
  statFile: StatFile = stat,
): Promise<void> {
  let info: Pick<Stats, "isDirectory">
  try {
    info = await statFile(webDistDir)
  } catch {
    throw new Error(`Missing Web dist: ${webDistDir}. Run "bun run build:web" before "bun run build:hub".`)
  }

  if (!info.isDirectory()) {
    throw new Error(`Web dist is not a directory: ${webDistDir}`)
  }
}

export function createHubBuildCommands(): string[][] {
  return [
    ["bunx", "--bun", "prisma", "generate"],
    ["bun", "build", "src/index.ts", "--compile", "--outfile", "dist/hub-server"],
  ]
}

async function runCommand(command: string[], options: { cwd: string }): Promise<void> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${command.join(" ")}`)
  }
}

export async function runHubServerBuild(options: {
  paths?: HubBuildPaths
  stat?: StatFile
  runCommand?: RunCommand
} = {}): Promise<void> {
  const paths = options.paths ?? resolveHubBuildPaths()
  const run = options.runCommand ?? runCommand

  await assertWebDistExists(paths.webDistDir, options.stat)
  for (const command of createHubBuildCommands()) {
    await run(command, { cwd: paths.hubRoot })
  }
}

if (import.meta.main) {
  runHubServerBuild().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
