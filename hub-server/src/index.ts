import { Hono } from 'hono'
import fs from 'node:fs'
import path from 'node:path'
import { initDatabase, closeDatabase } from './lib/db'
import { getAppDataDir } from './lib/path'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

async function start() {
  const dataDir = getAppDataDir()
  fs.mkdirSync(dataDir, { recursive: true })

  const dbPath = path.join(dataDir, 'hub.db')
  const dbUrl = `file:${dbPath}`

  await initDatabase(dbUrl)

  const shutdown = async () => {
    await closeDatabase()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

start().catch((err) => {
  console.error('Failed to initialize database:', err)
  process.exit(1)
})

export default app