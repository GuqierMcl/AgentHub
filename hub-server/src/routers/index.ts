import { Hono, Context } from 'hono'
import conversation from './conversation'
import provider from './provider'

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

// 后续新增领域路由在此添加：
// import message from './message'
// router.route('/', message)

export default router