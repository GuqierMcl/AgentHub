import { createServer } from 'node:net'
import { join } from 'node:path'
import { logger } from '../lib/logger'

export interface RuntimeEndpoint {
  port: number
  url: string
}

export interface SidecarStartOptions {
  bunBin?: string
  runtimeEntry?: string
  runtimeBin?: string
  hubUrl: string
  dataDir: string
  workdir: string
  logLevel: string
  token: string
}

interface RuntimeHealthProbe {
  status: string
}

interface SidecarProcess {
  exited: Promise<number | null>
  kill(signal?: NodeJS.Signals): void
}

interface SpawnOptions {
  env: Record<string, string>
  stdout: 'inherit'
  stderr: 'inherit'
}

interface SidecarManagerDependencies {
  allocatePort?: () => Promise<number>
  fetchHealth?: (url: string) => Promise<RuntimeHealthProbe>
  sleep?: (ms: number) => Promise<void>
  spawn?: (command: string[], options: SpawnOptions) => SidecarProcess
  onEndpointChanged?: (endpoint: RuntimeEndpoint) => void
}

const RUNTIME_HOSTNAME = '127.0.0.1'

export async function findAvailablePort(hostname = RUNTIME_HOSTNAME): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, hostname, () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address) {
          resolve(address.port)
          return
        }
        reject(new Error('Failed to allocate an available port'))
      })
    })
  })
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function defaultFetchHealth(url: string): Promise<RuntimeHealthProbe> {
  const response = await fetch(`${url}/health`)
  const body = await response.json().catch(() => null) as { status?: string } | null
  return { status: body?.status ?? (response.ok ? 'ok' : 'error') }
}

function defaultSpawn(command: string[], options: SpawnOptions): SidecarProcess {
  return Bun.spawn(command, {
    env: options.env,
    stdout: options.stdout,
    stderr: options.stderr,
  }) as SidecarProcess
}

export class SidecarManager {
  private process: SidecarProcess | null = null
  private endpoint: RuntimeEndpoint | null = null
  private startOptions: SidecarStartOptions | null = null
  private shuttingDown = false
  private restartFailures = 0
  private allocatePort: () => Promise<number>
  private fetchHealth: (url: string) => Promise<RuntimeHealthProbe>
  private sleep: (ms: number) => Promise<void>
  private spawn: (command: string[], options: SpawnOptions) => SidecarProcess
  private onEndpointChanged?: (endpoint: RuntimeEndpoint) => void

  constructor(deps: SidecarManagerDependencies = {}) {
    this.allocatePort = deps.allocatePort ?? findAvailablePort
    this.fetchHealth = deps.fetchHealth ?? defaultFetchHealth
    this.sleep = deps.sleep ?? defaultSleep
    this.spawn = deps.spawn ?? defaultSpawn
    this.onEndpointChanged = deps.onEndpointChanged
  }

  async start(options: SidecarStartOptions): Promise<RuntimeEndpoint> {
    this.startOptions = options
    this.shuttingDown = false

    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const port = await this.allocatePort()
      const endpoint = { port, url: `http://${RUNTIME_HOSTNAME}:${port}` }
      const command = this.createCommand(options, port)

      try {
        const childProcess = this.spawn(command, {
          env: {
            ...process.env,
            AGENTHUB_RUNTIME_TOKEN: options.token,
          },
          stdout: 'inherit',
          stderr: 'inherit',
        })
        this.process = childProcess
        await this.waitUntilReady(endpoint.url)
        this.endpoint = endpoint
        this.onEndpointChanged?.(endpoint)
        this.watchProcess(childProcess)
        logger.info({ runtimeUrl: endpoint.url }, 'Agent Runtime sidecar is ready')
        return endpoint
      } catch (err) {
        lastError = err
        this.process?.kill('SIGTERM')
        this.process = null
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to start Agent Runtime sidecar')
  }

  getEndpoint(): RuntimeEndpoint | null {
    return this.endpoint
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    const processToStop = this.process
    this.process = null
    this.endpoint = null

    if (!processToStop) {
      return
    }

    processToStop.kill('SIGTERM')
    await Promise.race([
      processToStop.exited,
      this.sleep(5000).then(() => {
        processToStop.kill('SIGKILL')
      }),
    ])
  }

  private createCommand(options: SidecarStartOptions, port: number): string[] {
    const runtimeArgs = [
      '--port',
      String(port),
      '--hostname',
      RUNTIME_HOSTNAME,
      '--hub-callback',
      options.hubUrl,
      '--data-dir',
      options.dataDir,
      '--workdir',
      options.workdir,
      '--log-level',
      options.logLevel,
    ]

    if (options.runtimeEntry) {
      if (!options.bunBin) {
        throw new Error('Missing Bun runtime path for Agent Runtime bundle sidecar startup')
      }
      return [
        options.bunBin,
        options.runtimeEntry,
        ...runtimeArgs,
      ]
    }

    if (!options.runtimeBin) {
      throw new Error('Missing Agent Runtime sidecar executable or bundle entry')
    }

    return [
      options.runtimeBin,
      ...runtimeArgs,
    ]
  }

  private async waitUntilReady(url: string): Promise<void> {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      try {
        const health = await this.fetchHealth(url)
        if (health.status === 'ok') {
          return
        }
      } catch {
        // Runtime may not be listening yet.
      }
      await this.sleep(200)
    }
    throw new Error('Agent Runtime sidecar did not become ready within 10 seconds')
  }

  private watchProcess(processToWatch: SidecarProcess): void {
    processToWatch.exited.then((exitCode) => {
      if (this.shuttingDown || this.process !== processToWatch || exitCode === 0) {
        return
      }
      void this.restartAfterUnexpectedExit(exitCode)
    }).catch((err) => {
      logger.warn({ err }, 'Agent Runtime sidecar exit watcher failed')
    })
  }

  private async restartAfterUnexpectedExit(exitCode: number | null): Promise<void> {
    if (!this.startOptions) {
      return
    }

    this.restartFailures += 1
    if (this.restartFailures > 3) {
      logger.error({ exitCode }, 'Agent Runtime sidecar restart limit reached')
      this.process = null
      this.endpoint = null
      return
    }

    const delayMs = Math.min(1000 * 2 ** (this.restartFailures - 1), 30_000)
    logger.warn({ exitCode, delayMs }, 'Agent Runtime sidecar exited unexpectedly; restarting')
    await this.sleep(delayMs)

    if (!this.shuttingDown) {
      await this.start(this.startOptions).catch(async (err) => {
        logger.error({ err }, 'Agent Runtime sidecar restart failed')
        if (!this.shuttingDown) {
          await this.restartAfterUnexpectedExit(null)
        }
      })
    }
  }
}

export function getDefaultRuntimeDataDir(dataDir: string): string {
  return join(dataDir, 'runtime')
}

export function getDefaultRuntimeWorkdir(dataDir: string): string {
  return join(dataDir, 'runtime-workspace')
}
