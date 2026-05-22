import { Hono, Context } from 'hono'

const router = new Hono()

router.get('/', (c: Context) => {
  return c.text('Hello Agent Runtime for AgentHub!')
})

router.get('/health', (c: Context) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})



export default router