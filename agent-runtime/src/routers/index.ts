import { Hono, Context } from 'hono'
import providers from './providers'
import agents from './agents'
import runs from './runs'
import services from './services'
import workspaceRevert from './workspace-revert'
import settings from './settings'
import instructRuns from './instruct-runs'
import capabilities from './capabilities'
import workspaceSkillTrust from './workspace-skill-trust'
import { runtimeReadiness } from '../runtime/readiness'
import mcpTrust from './mcp-trust'
import mcpRuntime from './mcp-runtime'

const router = new Hono()

router.get('/', (c: Context) => {
  return c.text('Hello Agent Runtime for AgentHub!')
})

router.get('/health', (c: Context) => {
  const health = runtimeReadiness.getHealth()
  return c.json(health, health.status === 'ok' ? 200 : 503)
})

// Provider API 路由
router.route('/', providers)
router.route('/', agents)
router.route('/', runs)
router.route('/', services)
router.route('/', workspaceRevert)
router.route('/', settings)
router.route('/', instructRuns)
router.route('/', capabilities)
router.route('/', workspaceSkillTrust)
router.route('/', mcpTrust)
router.route('/', mcpRuntime)

export default router
