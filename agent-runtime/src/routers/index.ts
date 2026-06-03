import { Hono, Context } from 'hono'
import providers from './providers'
import agents from './agents'
import runs from './runs'
import services from './services'

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
router.route('/', services)

export default router
