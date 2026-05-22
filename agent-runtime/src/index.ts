import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { config } from './config'
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

console.log(banner)
console.log(`Agent Runtime listening on ${server.url}`)
console.log(`Data directory: ${config.dataDir}`)
