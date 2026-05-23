import { Hono, Context, Next } from 'hono'
import { cors } from 'hono/cors'
import fs from 'node:fs'
import { initDatabase, closeDatabase } from './lib/db'
import { errorHandler } from './lib/errors'
import { ConversationService } from './services/conversation.service'
import { RuntimeClient } from './lib/runtime'
import { config } from './config'
import { logger, requestLogger } from './lib/logger'
import router from './routers'

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

const conversationService = new ConversationService()
const runtimeClient = new RuntimeClient(config.runtimeUrl)

app.use('*', async (c: Context, next: Next) => {
  c.set('conversationService', conversationService)
  c.set('runtimeClient', runtimeClient)
  await next()
})

app.route('/', router)

async function start() {
  logger.level = config.logLevel
  fs.mkdirSync(config.dataDir, { recursive: true })
  await initDatabase(config.dbUrl)

  logger.info({ port: config.port, hostname: config.hostname, dataDir: config.dataDir, runtimeUrl: config.runtimeUrl }, 'Hub Server listening')
}

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start')
  process.exit(1)
})

const shutdown = async () => {
  logger.info('Shutting down')
  await closeDatabase()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

export default {
  port: config.port,
  hostname: config.hostname,
  fetch: app.fetch,
}