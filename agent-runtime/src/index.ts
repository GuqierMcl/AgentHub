import { Hono, Context, Next } from 'hono'
import { cors } from 'hono/cors'
import { config } from './config'
import { AgentRegistry, InstructAgentRegistry } from './agents'
import { ProviderService } from './provider'
import {
  RunManager,
  CapabilityDiscoveryService,
  SystemModelSettingsService,
  SystemModelSettingsStore,
  WorkspaceRevertService,
  createDefaultRuntimeToolRegistry,
} from './runtime'
import {
  InstructAgentExecutor,
  InstructRunManager,
  createInstructRuntimeToolRegistry,
} from './instruct-runtime'
import router from './routers'

const app = new Hono()

// 配置 CORS 中间件
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
  // 默认允许所有来源（开发环境）
  app.use('*', cors())
}

// 初始化 ProviderService
const providerService = new ProviderService(config.dataDir)
const toolRegistry = createDefaultRuntimeToolRegistry()
const agentRegistry = new AgentRegistry(config.dataDir, toolRegistry)
const systemModelSettingsService = new SystemModelSettingsService(
  new SystemModelSettingsStore(config.dataDir),
  providerService
)
const runManager = new RunManager(
  agentRegistry,
  providerService,
  undefined,
  toolRegistry,
  undefined,
  systemModelSettingsService
)
const workspaceRevertService = new WorkspaceRevertService()
const capabilityDiscoveryService = new CapabilityDiscoveryService({ dataDir: config.dataDir })

const instructAgentRegistry = new InstructAgentRegistry()
const instructToolRegistry = createInstructRuntimeToolRegistry(config.dataDir, {
  onSavedAgent: async (agent) => {
    await agentRegistry.syncPersistedUserAgent(agent)
  },
})
const instructExecutor = new InstructAgentExecutor(
  providerService,
  instructToolRegistry,
  systemModelSettingsService
)
const instructRunManager = new InstructRunManager(instructAgentRegistry, instructExecutor)

// 注入 ProviderService 到 Context
app.use('*', async (c: Context, next: Next) => {
  c.set('providerService', providerService)
  c.set('agentRegistry', agentRegistry)
  c.set('runManager', runManager)
  c.set('workspaceRevertService', workspaceRevertService)
  c.set('capabilityDiscoveryService', capabilityDiscoveryService)
  c.set('toolRegistry', toolRegistry)
  c.set('systemModelSettingsService', systemModelSettingsService)
  c.set('instructAgentRegistry', instructAgentRegistry)
  c.set('instructRunManager', instructRunManager)
  await next()
})

// 组合路由
app.route('/', router)

// Banner
const banner = `
   █████╗  ██████╗ ███████╗███╗   ██╗████████╗██╗  ██╗██╗   ██╗██████╗ 
  ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║  ██║██║   ██║██╔══██╗
  ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ███████║██║   ██║██████╔╝
  ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██╔══██║██║   ██║██╔══██╗
  ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║  ██║╚██████╔╝██████╔╝
  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═════╝
  ───────────────────── ✦ Agent-Runtime ✦ ─────────────────────
`

// 启动服务器
const server = Bun.serve({
  port: config.port,
  hostname: config.hostname,
  fetch: app.fetch,
  idleTimeout: 60,
})

// 初始化 Runtime services
Promise.all([
  providerService.initialize(),
  agentRegistry.initialize(),
  systemModelSettingsService.initialize(),
]).then(() => {
  console.log(banner)
  console.log(`Agent Runtime listening on ${server.url}`)
  console.log(`Data directory: ${config.dataDir}`)
}).catch((error) => {
  console.error('Failed to initialize Agent Runtime services:', error)
  console.log(banner)
  console.log(`Agent Runtime listening on ${server.url}`)
  console.log(`Data directory: ${config.dataDir}`)
})
