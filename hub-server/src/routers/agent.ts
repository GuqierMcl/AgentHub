import { Hono, Context } from 'hono'
import { z } from 'zod'
import type { RuntimeClient } from '../lib/runtime'
import type { ConversationService } from '../services/conversation.service'
import type { Logger } from 'pino'
import { findConversationAgentsByAgentId } from '../repositories/conversation-agent.repo'
import { resolveConversationWorkspaceSnapshot } from '../workspaces/conversation-workspace'

declare module 'hono' {
  interface ContextVariableMap {
    runtimeClient: RuntimeClient
    conversationService: ConversationService
    logger: Logger
  }
}

const agent = new Hono()

const OpenCodeModelCatalogBrowserRequestSchema = z.object({
  conversationId: z.string().trim().min(1),
}).strict()
const INVALID_JSON_BODY = Symbol('invalid-json')

const OpenCodeModelSettingSchema = z.object({
  providerID: z.string().trim().min(1),
  modelID: z.string().trim().min(1),
}).strict()

const OpenCodeExternalSettingsSchema = z.object({
  provider: z.literal('opencode'),
  model: OpenCodeModelSettingSchema.optional(),
  executionAgent: z.enum(['build', 'plan']).optional(),
})

const OpenCodeExternalSettingsWrapperSchema = z.object({
  settings: OpenCodeExternalSettingsSchema,
  conversationId: z.string().trim().optional(),
})

const OPENCODE_FORBIDDEN_LOCAL_PATH_KEYS = new Set([
  'workspace',
  'rootPath',
  'workspaceRoot',
  'workspaceRootPath',
  'localPath',
  'directory',
  'cwd',
])

agent.post('/api/runtime/agents', async (c: Context) => {
  const client = c.get('runtimeClient')
  const body = await c.req.json()
  const { data, status } = await client.forward('POST', '/runtime/agents', body, { raw: true })
  return c.json(data, status as 200)
})

agent.get('/api/runtime/agents', async (c: Context) => {
  const client = c.get('runtimeClient')
  const query = c.req.query()
  const queryString = new URLSearchParams(query).toString()
  const path = queryString ? `/runtime/agents?${queryString}` : '/runtime/agents'
  const { data, status } = await client.forward('GET', path, undefined, { raw: true })
  return c.json(data, status as 200)
})

agent.get('/api/runtime/agents/authoring-options', async (c: Context) => {
  const client = c.get('runtimeClient')
  const { data, status } = await client.forward('GET', '/runtime/agents/authoring-options', undefined, { raw: true })
  return c.json(data, status as 200)
})

agent.get('/api/runtime/agents/:agentId/external-settings', async (c: Context) => {
  const client = c.get('runtimeClient')
  const agentId = c.req.param('agentId')!
  const { data, status } = await client.forward('GET', `/runtime/agents/${encodeURIComponent(agentId)}/external-settings`, undefined, { raw: true })
  return c.json(data, status as 200)
})

agent.put('/api/runtime/agents/:agentId/external-settings', async (c: Context) => {
  const client = c.get('runtimeClient')
  const agentId = c.req.param('agentId')!
  const body = await readJsonBody(c)
  if (body === INVALID_JSON_BODY) {
    return agentInvalidInput(c, [{ message: 'Malformed JSON body' }])
  }
  if (agentId === 'opencode') {
    const prepared = await prepareOpenCodeExternalSettings(c, client, body)
    if ('response' in prepared) {
      return prepared.response
    }
    const { data, status } = await client.forward('PUT', '/runtime/agents/opencode/external-settings', prepared.settings, { raw: true })
    return c.json(data, status as 200)
  }
  const { data, status } = await client.forward('PUT', `/runtime/agents/${encodeURIComponent(agentId)}/external-settings`, body, { raw: true })
  return c.json(data, status as 200)
})

agent.post('/api/runtime/agents/opencode/model-catalog', async (c: Context) => {
  const body = await readJsonBody(c)
  const input = OpenCodeModelCatalogBrowserRequestSchema.safeParse(body)
  if (!input.success) {
    return c.json({
      error: {
        code: 'OPENCODE_MODEL_CATALOG_INVALID_INPUT',
        message: 'conversationId is required to resolve a workspace for OpenCode model catalog',
        details: input.error.issues,
      },
    }, 400)
  }

  const conversationService = c.get('conversationService')
  const workspace = await resolveConversationWorkspaceSnapshot(conversationService, input.data.conversationId)
  const client = c.get('runtimeClient')
  const { data, status } = await client.forward(
    'POST',
    '/runtime/agents/opencode/model-catalog',
    { workspace },
    { raw: true },
  )
  return c.json(data, status as 200)
})

agent.get('/api/runtime/agents/:agentId', async (c: Context) => {
  const client = c.get('runtimeClient')
  const agentId = c.req.param('agentId')!
  const query = c.req.query()
  const queryString = new URLSearchParams(query).toString()
  const path = queryString ? `/runtime/agents/${encodeURIComponent(agentId)}?${queryString}` : `/runtime/agents/${encodeURIComponent(agentId)}`
  const { data, status } = await client.forward('GET', path, undefined, { raw: true })
  return c.json(data, status as 200)
})

agent.put('/api/runtime/agents/:agentId', async (c: Context) => {
  const client = c.get('runtimeClient')
  const agentId = c.req.param('agentId')!
  const body = await c.req.json()
  const { data, status } = await client.forward('PUT', `/runtime/agents/${encodeURIComponent(agentId)}`, body, { raw: true })
  return c.json(data, status as 200)
})

agent.delete('/api/runtime/agents/:agentId', async (c: Context) => {
  const client = c.get('runtimeClient')
  const service = c.get('conversationService')
  const logger = c.get('logger')
  const agentId = c.req.param('agentId')!

  const records = await findConversationAgentsByAgentId(agentId)
  if (records.length > 0) {
    const convIds = [...new Set(records.map((r) => r.conversationId))]
    logger.info({ agentId, conversationIds: convIds }, 'Archiving conversations that contain the agent being deleted')
    await Promise.all(convIds.map((convId) => service.archiveConversation(convId)))
  }

  const { data, status } = await client.forward('DELETE', `/runtime/agents/${encodeURIComponent(agentId)}`, undefined, { raw: true })
  return c.json(data, status as 200)
})

agent.put('/api/runtime/agents/:agentId/model', async (c: Context) => {
  const client = c.get('runtimeClient')
  const agentId = c.req.param('agentId')!
  const body = await c.req.json()
  const { data, status } = await client.forward('PUT', `/runtime/agents/${encodeURIComponent(agentId)}/model`, body, { raw: true })
  return c.json(data, status as 200)
})

agent.delete('/api/runtime/agents/:agentId/model', async (c: Context) => {
  const client = c.get('runtimeClient')
  const agentId = c.req.param('agentId')!
  const { data, status } = await client.forward('DELETE', `/runtime/agents/${encodeURIComponent(agentId)}/model`, undefined, { raw: true })
  return c.json(data, status as 200)
})

async function readJsonBody(c: Context): Promise<unknown> {
  const raw = await c.req.text()
  if (raw.trim().length === 0) {
    return {}
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return INVALID_JSON_BODY
  }
}

function agentInvalidInput(c: Context, details: unknown) {
  return c.json({
    error: {
      code: 'AGENT_INVALID_INPUT',
      message: 'Invalid agent input',
      details,
    },
  }, 400)
}

async function prepareOpenCodeExternalSettings(
  c: Context,
  client: RuntimeClient,
  body: unknown,
): Promise<{ settings: OpenCodeExternalSettings } | { response: Response }> {
  if (containsForbiddenOpenCodeLocalPathKey(body)) {
    return { response: agentInvalidInput(c, [{ message: 'OpenCode settings must not include workspace or local path fields' }]) }
  }

  const directSettings = OpenCodeExternalSettingsSchema.safeParse(body)
  const wrapperSettings = OpenCodeExternalSettingsWrapperSchema.safeParse(body)
  const parsed = wrapperSettings.success
    ? { settings: wrapperSettings.data.settings, conversationId: wrapperSettings.data.conversationId }
    : directSettings.success
      ? { settings: directSettings.data, conversationId: undefined }
      : undefined

  if (!parsed) {
    return {
      response: agentInvalidInput(c, [
        ...(directSettings.success ? [] : directSettings.error.issues),
        ...(wrapperSettings.success ? [] : wrapperSettings.error.issues),
      ]),
    }
  }

  if (!parsed.settings.model) {
    return { settings: parsed.settings }
  }

  const conversationId = parsed.conversationId?.trim()
  if (!conversationId) {
    return { response: agentInvalidInput(c, [{ message: 'conversationId is required for OpenCode model override settings' }]) }
  }

  const conversationService = c.get('conversationService')
  const workspace = await resolveConversationWorkspaceSnapshot(conversationService, conversationId)
  const catalog = await client.forward(
    'POST',
    '/runtime/agents/opencode/model-catalog',
    { workspace },
    { raw: true },
  )
  if (catalog.status < 200 || catalog.status >= 300) {
    return { response: c.json(catalog.data, catalog.status as 200) }
  }

  if (!openCodeCatalogContainsModel(catalog.data, parsed.settings.model)) {
    return {
      response: c.json({
        error: {
          code: 'OPENCODE_MODEL_NOT_IN_CATALOG',
          message: 'OpenCode model is not available in the resolved workspace catalog',
          details: {
            providerID: parsed.settings.model.providerID,
            modelID: parsed.settings.model.modelID,
          },
        },
      }, 400),
    }
  }

  return { settings: parsed.settings }
}

type OpenCodeExternalSettings = z.infer<typeof OpenCodeExternalSettingsSchema>
type OpenCodeModelSetting = z.infer<typeof OpenCodeModelSettingSchema>

function containsForbiddenOpenCodeLocalPathKey(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (OPENCODE_FORBIDDEN_LOCAL_PATH_KEYS.has(key)) {
      return true
    }
    if (containsForbiddenOpenCodeLocalPathKey(nestedValue)) {
      return true
    }
  }

  return false
}

function openCodeCatalogContainsModel(catalog: unknown, requestedModel: OpenCodeModelSetting): boolean {
  const models = isRecord(catalog) && Array.isArray(catalog.models) ? catalog.models : []
  return models.some((model) => {
    if (!isRecord(model)) {
      return false
    }
    return model.providerID === requestedModel.providerID && model.modelID === requestedModel.modelID
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export default agent
