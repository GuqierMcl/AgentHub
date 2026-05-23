import { Hono, Context, Next } from 'hono'
import { cors } from 'hono/cors'
import fs from 'node:fs'
import { initDatabase, closeDatabase } from './lib/db'
import { errorHandler } from './lib/errors'
import { ConversationService } from './services/conversation.service'
import { config } from './config'
import router from './routers'

const app = new Hono()

app.onError(errorHandler)

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

app.use('*', async (c: Context, next: Next) => {
  c.set('conversationService', conversationService)
  await next()
})

app.route('/', router)

async function start() {
  fs.mkdirSync(config.dataDir, { recursive: true })
  await initDatabase(config.dbUrl)

  console.log(`Hub Server listening on http://${config.hostname}:${config.port}`)
  console.log(`Data directory: ${config.dataDir}`)
}

start().catch((err) => {
  console.error('Failed to start:', err)
  process.exit(1)
})

const shutdown = async () => {
  console.log('Shutting down...')
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