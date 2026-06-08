import { Hono, Context, Next } from 'hono'
import { cors } from 'hono/cors'
import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import { closeDatabase } from './lib/db'
import { errorHandler } from './lib/errors'
import { ConversationService } from './services/conversation.service'
import { RuntimeClient } from './lib/runtime'
import { RunPersistenceService } from './services/run-persistence.service'
import { HubEventBus } from './services/hub-event-bus.service'
import { ServiceStatusMonitor } from './services/service-status.service'
import { TerminalService } from './services/terminal/terminal.service'
import { extractTerminalConfig } from './services/terminal/types'
import { loadSettings } from './routers/settings'
import { websocket } from './routers/terminal'
import { config } from './config'
import { logger, requestLogger } from './lib/logger'
import {
  getDefaultRuntimeDataDir,
  getDefaultRuntimeWorkdir,
  SidecarManager,
} from './services/sidecar-manager'
import { attachStaticWeb } from './bootstrap/static'
import { bootstrapDatabase } from './bootstrap/database'
import router from './routers'

const banner = `
   █████╗  ██████╗ ███████╗███╗   ██╗████████╗██╗  ██╗██╗   ██╗██████╗ 
  ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║  ██║██║   ██║██╔══██╗
  ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ███████║██║   ██║██████╔╝
  ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██╔══██║██║   ██║██╔══██╗
  ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║  ██║╚██████╔╝██████╔╝
  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═════╝
  ───────────────────── ✦ Hub-Server ✦ ─────────────────────
`

interface HubAppDependencies {
  runtimeClient: RuntimeClient
  conversationService: ConversationService
  runPersistenceService: RunPersistenceService
  hubEventBus: HubEventBus
  terminalService: TerminalService
}

interface HubServerHandle {
  port?: number
  stop(closeActiveConnections?: boolean): void
}

let server: HubServerHandle | null = null
let sidecarManager: SidecarManager | null = null
let serviceStatusMonitor: ServiceStatusMonitor | null = null
let terminalService: TerminalService | null = null
let shuttingDown = false

function createHubApp(deps: HubAppDependencies): Hono {
  const app = new Hono()

  app.onError(errorHandler)
  app.use('*', requestLogger())

  if (config.cors.length > 0) {
    app.use('*', cors({
      origin: config.cors,
      allowMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'],
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['Content-Length'],
      maxAge: 86400,
      credentials: true,
    }))
  } else {
    app.use('*', cors())
  }

  app.use('*', async (c: Context, next: Next) => {
    c.set('conversationService', deps.conversationService)
    c.set('runtimeClient', deps.runtimeClient)
    c.set('runPersistenceService', deps.runPersistenceService)
    c.set('hubEventBus', deps.hubEventBus)
    c.set('terminalService', deps.terminalService)
    await next()
  })

  app.route('/', router)
  attachStaticWebIfConfigured(app)
  return app
}

function attachStaticWebIfConfigured(app: Hono): void {
  if (config.noWeb || !config.publicDir) {
    return
  }

  if (!fs.existsSync(config.publicDir)) {
    const message = 'Configured Web public directory does not exist'
    if (config.runtimeEntry || config.runtimeBin) {
      throw new Error(`${message}: ${config.publicDir}`)
    }
    logger.warn({ publicDir: config.publicDir }, message)
    return
  }

  attachStaticWeb(app, { publicDir: config.publicDir })
}

function createHubUrl(): string {
  const hostname = config.hostname === '0.0.0.0' ? '127.0.0.1' : config.hostname
  return `http://${hostname}:${config.port}`
}

async function createRuntimeClient(): Promise<RuntimeClient> {
  if (!config.runtimeEntry && !config.runtimeBin) {
    return new RuntimeClient(config.runtimeUrl)
  }

  const token = randomBytes(32).toString('hex')
  const runtimeClient = new RuntimeClient(config.runtimeUrl, { token })
  const runtimeDataDir = getDefaultRuntimeDataDir(config.dataDir)
  const runtimeWorkdir = getDefaultRuntimeWorkdir(config.dataDir)
  fs.mkdirSync(runtimeDataDir, { recursive: true })
  fs.mkdirSync(runtimeWorkdir, { recursive: true })

  sidecarManager = new SidecarManager({
    onEndpointChanged: (endpoint) => {
      runtimeClient.setBaseUrl(endpoint.url)
    },
  })
  const endpoint = await sidecarManager.start({
    bunBin: config.bunBin,
    runtimeEntry: config.runtimeEntry,
    runtimeBin: config.runtimeBin,
    hubUrl: createHubUrl(),
    dataDir: runtimeDataDir,
    workdir: runtimeWorkdir,
    logLevel: config.logLevel,
    token,
  })
  runtimeClient.setBaseUrl(endpoint.url)
  return runtimeClient
}

async function start(): Promise<void> {
  logger.level = config.logLevel
  fs.mkdirSync(config.dataDir, { recursive: true })
  await bootstrapDatabase({ config })

  const runtimeClient = await createRuntimeClient()
  const hubEventBus = new HubEventBus()
  const conversationService = new ConversationService(hubEventBus)
  const runPersistenceService = new RunPersistenceService(runtimeClient, hubEventBus)
  serviceStatusMonitor = new ServiceStatusMonitor(runtimeClient, hubEventBus)
  terminalService = new TerminalService(() => extractTerminalConfig(loadSettings()))
  terminalService.startCleanup()

  const app = createHubApp({
    runtimeClient,
    conversationService,
    runPersistenceService,
    hubEventBus,
    terminalService,
  })

  const listeningServer = Bun.serve({
    port: config.port,
    hostname: config.hostname,
    fetch: app.fetch,
    websocket,
    idleTimeout: 60,
  })
  server = listeningServer

  serviceStatusMonitor.start()
  process.stdout.write(banner)
  logger.info({
    port: listeningServer.port ?? config.port,
    hostname: config.hostname,
    dataDir: config.dataDir,
    runtimeUrl: sidecarManager?.getEndpoint()?.url ?? config.runtimeUrl,
    web: Boolean(config.publicDir && !config.noWeb),
  }, 'Hub Server listening')
}

start().catch(async (err) => {
  logger.fatal({ err }, 'Failed to start')
  await sidecarManager?.shutdown()
  await closeDatabase()
  process.exit(1)
})

const shutdown = async () => {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  logger.info('Shutting down')
  serviceStatusMonitor?.stop()
  terminalService?.shutdown()
  await sidecarManager?.shutdown()
  await closeDatabase()
  server?.stop(true)
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
