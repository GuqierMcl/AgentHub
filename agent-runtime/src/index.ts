import { Hono, Context, Next } from 'hono'
import { cors } from 'hono/cors'
import { config } from './config'
import { AgentRegistry } from './agents'
import { ProviderService } from './provider'
import { WorkspaceService } from './runtime/workspace'
import { RunManager } from './runtime'
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
const agentRegistry = new AgentRegistry(config.dataDir)
const workspaceService = new WorkspaceService({
  workdir: config.workdir,
})
const runManager = new RunManager(agentRegistry, providerService, workspaceService)

// 注入 ProviderService 到 Context
app.use('*', async (c: Context, next: Next) => {
  c.set('providerService', providerService)
  c.set('agentRegistry', agentRegistry)
  c.set('workspaceService', workspaceService)
  c.set('runManager', runManager)
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
`

// 启动服务器
const server = Bun.serve({
  port: config.port,
  hostname: config.hostname,
  fetch: app.fetch,
})

// 初始化 Runtime services
Promise.all([
  providerService.initialize(),
  agentRegistry.initialize(),
]).then(() => {
  console.log(banner)
  console.log(`Agent Runtime listening on ${server.url}`)
  console.log(`Data directory: ${config.dataDir}`)
  console.log(`Workspace root: ${config.workdir}`)
}).catch((error) => {
  console.error('Failed to initialize Agent Runtime services:', error)
  console.log(banner)
  console.log(`Agent Runtime listening on ${server.url}`)
  console.log(`Data directory: ${config.dataDir}`)
  console.log(`Workspace root: ${config.workdir}`)
})
