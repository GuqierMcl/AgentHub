export function createRuntimeBuildCommand(): string[] {
  return [
    "bun",
    "build",
    "src/index.ts",
    "--target",
    "bun",
    "--outdir",
    "dist",
    "--external",
    "pino",
    "--external",
    "pino-pretty",
    "--external",
    "thread-stream",
    "--external",
    "sonic-boom",
  ]
}

async function runRuntimeBuild(command = createRuntimeBuildCommand()): Promise<void> {
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
  runRuntimeBuild().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
