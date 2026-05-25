import { Hono, Context } from 'hono'
import conversation from './conversation'
import provider from './provider'
import agent from './agent'
import runs from './runs'

const router = new Hono()

router.get('/health', (c: Context) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

// 领域路由挂载
router.route('/', conversation)
router.route('/', provider)
router.route('/', agent)
router.route('/', runs)

export default router