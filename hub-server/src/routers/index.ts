import { Hono, Context } from 'hono'
import conversation from './conversation'
import provider from './provider'
import agent from './agent'
import runs from './runs'
import messages from './messages'
import workspace from './workspace'
import settings from './settings'
import events from './events'
import preview from './preview'
import terminal from './terminal'

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
router.route('/', messages)
router.route('/', runs)
router.route('/', workspace)
router.route('/', settings)
router.route('/', events)
router.route('/', preview)
router.route('/', terminal)

export default router
