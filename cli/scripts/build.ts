export function createCliBuildCommand(
  platform: NodeJS.Platform = process.platform,
): string[] {
  const command = [
    "bun",
    "build",
    "src/index.ts",
    "--compile",
    "--outfile",
    "dist/agenthub-cli",
  ]

  if (platform === "win32") {
    command.push("--windows-icon", "../desktop/assets/icon.ico")
  }

  return command
}

async function runCliBuild(command = createCliBuildCommand()): Promise<void> {
  const proc = Bun.spawn(command, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${command.join(" ")}`)
  }
}

if (import.meta.main) {
  runCliBuild().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
