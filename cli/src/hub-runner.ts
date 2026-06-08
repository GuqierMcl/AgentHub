import type { DistributionPaths } from "./distribution"

export interface HubServerProcess {
  exited: Promise<number | null>
  kill(signal?: NodeJS.Signals): void
}

interface StartHubServerOptions {
  port: number
  paths: DistributionPaths
  dataDir?: string
  logLevel?: string
  readyTimeoutMs?: number
  spawn?: (command: string[]) => HubServerProcess
  fetchHealth?: (url: string) => Promise<boolean>
  sleep?: (ms: number) => Promise<void>
}

export interface RunningHubServer {
  url: string
  process: HubServerProcess
}

function defaultSpawn(command: string[]): HubServerProcess {
  return Bun.spawn(command, {
    stdout: "inherit",
    stderr: "inherit",
  }) as HubServerProcess
}

async function defaultFetchHealth(url: string): Promise<boolean> {
  const response = await fetch(`${url}/health`)
  const body = await response.json().catch(() => null) as { status?: string } | null
  return response.ok && body?.status === "ok"
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createHubServerCommand(options: {
  port: number
  paths: DistributionPaths
  dataDir?: string
  logLevel?: string
}): string[] {
  const command = [
    options.paths.bunBin,
    options.paths.hubServerEntry,
    "--port",
    String(options.port),
    "--hostname",
    "127.0.0.1",
    "--bun-bin",
    options.paths.bunBin,
    "--runtime-entry",
    options.paths.runtimeEntry,
    "--public-dir",
    options.paths.publicDir,
  ]

  if (options.dataDir) {
    command.push("--data-dir", options.dataDir)
  }
  if (options.logLevel) {
    command.push("--log-level", options.logLevel)
  }

  return command
}

async function waitForHubReady(options: {
  url: string
  readyTimeoutMs: number
  fetchHealth: (url: string) => Promise<boolean>
  sleep: (ms: number) => Promise<void>
}): Promise<void> {
  const deadline = Date.now() + options.readyTimeoutMs
  while (Date.now() < deadline) {
    if (await options.fetchHealth(options.url).catch(() => false)) {
      return
    }
    await options.sleep(200)
  }
  throw new Error(`HubServer did not become ready at ${options.url}`)
}

export async function startHubServer(options: StartHubServerOptions): Promise<RunningHubServer> {
  const spawn = options.spawn ?? defaultSpawn
  const fetchHealth = options.fetchHealth ?? defaultFetchHealth
  const sleep = options.sleep ?? defaultSleep
  const readyTimeoutMs = options.readyTimeoutMs ?? 30_000
  const url = `http://127.0.0.1:${options.port}`
  const process = spawn(createHubServerCommand(options))

  try {
    await waitForHubReady({
      url,
      readyTimeoutMs,
      fetchHealth,
      sleep,
    })
  } catch (err) {
    process.kill("SIGTERM")
    throw err
  }

  return {
    url,
    process,
  }
}

export async function shutdownHubServer(
  process: HubServerProcess,
  signal: NodeJS.Signals,
  _sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<number | null> {
  process.kill(signal)
  return process.exited
}
