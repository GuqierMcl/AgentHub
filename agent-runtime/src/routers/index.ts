import { Hono, Context } from 'hono'
import providers from './providers'
import agents from './agents'
import runs from './runs'

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

// Provider API 路由
router.route('/', providers)
router.route('/', agents)
router.route('/', runs)

export default router
