import { Hono, type Context } from "hono"
import { AgentRegistry, AgentRegistryMutationError } from "../agents"
import {
  AgentListQuerySchema,
  AgentDetailQuerySchema,
  AgentModelBindingUpdateRequestSchema,
  UserAgentCreateRequestSchema,
  UserAgentUpdateRequestSchema,
  DEFAULT_USER_AGENT_PERMISSION_POLICY,
  type AgentDefinition,
  type AgentAuthoringOptionsResponse,
  type AgentDetailResponse,
  type AgentSummaryResponse,
} from "../agents"
import { resolveAgentModelSnapshot } from "../runtime/model-resolver"
import type { RuntimeToolRegistry } from "../runtime"
import type { ProviderService } from "../provider"

declare module "hono" {
  interface ContextVariableMap {
    agentRegistry: AgentRegistry
    providerService: ProviderService
    toolRegistry: RuntimeToolRegistry
  }
}

const agents = new Hono()

const userAgentCapabilityTagOptions = [
  "Implementation",
  "Review",
  "Documentation",
  "Planning",
  "Research",
  "Summarization",
  "Rewrite",
  "Codebase Scan",
  "Thinking",
] as const

function serializeAgentSummary(
  agent: AgentDefinition,
  providerService: ProviderService
): AgentSummaryResponse {
  const resolvedModel = resolveAgentModelSnapshot(providerService, agent)
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    tier: agent.tier,
    origin: agent.origin,
    visibility: agent.visibility,
    entryPolicy: agent.entryPolicy,
    delegationPolicy: agent.delegationPolicy,
    executorType: agent.executorType,
    capabilities: agent.capabilities,
    enabled: agent.enabled,
    readonly: agent.readonly,
    modelRef: agent.modelRef,
    resolvedModel: resolvedModel ?? undefined,
  }
}

function serializeAgentDetail(
  agent: AgentDefinition,
  providerService: ProviderService
): AgentDetailResponse {
  const resolvedModel = resolveAgentModelSnapshot(providerService, agent)
  return {
    ...serializeAgentSummary(agent, providerService),
    systemPrompt: agent.origin === "user" && !agent.readonly
      ? agent.systemPrompt
      : undefined,
    allowedSubagents: agent.allowedSubagents,
    allowedTools: agent.allowedTools,
    permissionPolicy: agent.permissionPolicy,
    toolPermissionRules: agent.toolPermissionRules,
    modelRef: agent.modelRef,
    resolvedModel: resolvedModel ?? undefined,
    external: agent.external
      ? {
          provider: agent.external.provider,
          outputFormat: agent.external.outputFormat,
          workingDirectoryPolicy: agent.external.workingDirectoryPolicy,
          configDirectoryPolicy: agent.external.configDirectoryPolicy,
        }
      : undefined,
  }
}

function serializeAuthoringOptions(registry: AgentRegistry, toolRegistry: RuntimeToolRegistry): AgentAuthoringOptionsResponse {
  const tools = toolRegistry.listUserConfigurableTools()
  const subagents = registry.listAgents({
    includeHidden: true,
    enabledOnly: true,
    tier: "subagent",
  }).map((agent) => ({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    capabilities: agent.capabilities,
  }))

  return {
    tools,
    capabilityTags: [...userAgentCapabilityTagOptions],
    subagents,
    defaults: {
      allowedTools: [],
      allowedSubagents: [],
      permissionPolicy: {
        ...DEFAULT_USER_AGENT_PERMISSION_POLICY,
      },
    },
  }
}

function invalidFilter(c: Context, details: unknown) {
  return c.json({
    error: {
      code: "AGENT_INVALID_FILTER",
      message: "Invalid agent filter query",
      details,
    },
  }, 400)
}

function registryUnavailable(c: Context) {
  return c.json({
    error: {
      code: "AGENT_REGISTRY_UNAVAILABLE",
      message: "Agent registry is not initialized",
    },
  }, 503)
}

function agentModelBindingNotAllowed(c: Context, agentId: string, reason: string) {
  return c.json({
    error: {
      code: "AGENT_MODEL_BINDING_NOT_ALLOWED",
      message: `Agent ${agentId} cannot bind a model`,
      details: {
        reason,
      },
    },
  }, 403)
}

function agentModelBindingInvalid(c: Context, details: unknown) {
  return c.json({
    error: {
      code: "AGENT_MODEL_BINDING_INVALID",
      message: "Invalid agent model binding",
      details,
    },
  }, 400)
}

function agentInvalidInput(c: Context, details: unknown) {
  return c.json({
    error: {
      code: "AGENT_INVALID_INPUT",
      message: "Invalid agent input",
      details,
    },
  }, 400)
}

function agentNotFound(c: Context, agentId: string) {
  return c.json({
    error: {
      code: "AGENT_NOT_FOUND",
      message: `Agent ${agentId} not found`,
    },
  }, 404)
}

function agentMutationFailed(c: Context, error: unknown) {
  if (error instanceof AgentRegistryMutationError) {
    return c.json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    }, error.status)
  }

  return c.json({
    error: {
      code: "AGENT_STORE_WRITE_FAILED",
      message: "Failed to mutate user agent",
      details: {
        message: error instanceof Error ? error.message : String(error),
      },
    },
  }, 500)
}

async function readJsonBody(c: Context): Promise<unknown> {
  return c.req.json().catch(() => null)
}

agents.post("/runtime/agents", async (c: Context) => {
  const registry = c.get("agentRegistry")
  const providerService = c.get("providerService")
  if (!registry.isInitialized()) {
    return registryUnavailable(c)
  }

  const body = await readJsonBody(c)
  const result = UserAgentCreateRequestSchema.safeParse(body)
  if (!result.success) {
    return agentInvalidInput(c, result.error.issues)
  }

  try {
    const agent = await registry.createUserAgent(result.data)
    return c.json(serializeAgentDetail(agent, providerService), 201)
  } catch (error) {
    return agentMutationFailed(c, error)
  }
})

agents.get("/runtime/agents", (c: Context) => {
  const result = AgentListQuerySchema.safeParse({
    includeHidden: c.req.query("includeHidden"),
    enabledOnly: c.req.query("enabledOnly"),
    tier: c.req.query("tier"),
    origin: c.req.query("origin"),
  })

  if (!result.success) {
    return invalidFilter(c, result.error.issues)
  }

  const registry = c.get("agentRegistry")
  const providerService = c.get("providerService")
  if (!registry.isInitialized()) {
    return registryUnavailable(c)
  }

  const includeHidden = result.data.includeHidden === "true"
  const enabledOnly = result.data.enabledOnly !== "false"
  const tier = result.data.tier ?? (includeHidden ? undefined : "primary")

  const visibleAgents = registry.listAgents({
    includeHidden,
    enabledOnly,
    tier,
    origin: result.data.origin,
  })

  return c.json({
    agents: visibleAgents.map((agent: AgentDefinition) => serializeAgentSummary(agent, providerService)),
  })
})

agents.get("/runtime/agents/authoring-options", (c: Context) => {
  const registry = c.get("agentRegistry")
  if (!registry.isInitialized()) {
    return registryUnavailable(c)
  }

  return c.json(serializeAuthoringOptions(registry, c.get("toolRegistry")))
})

agents.get("/runtime/agents/:agentId", (c: Context) => {
  const result = AgentDetailQuerySchema.safeParse({
    includeHidden: c.req.query("includeHidden"),
  })

  if (!result.success) {
    return invalidFilter(c, result.error.issues)
  }

  const registry = c.get("agentRegistry")
  const providerService = c.get("providerService")
  if (!registry.isInitialized()) {
    return registryUnavailable(c)
  }

  const agentId = c.req.param("agentId")!
  const agent = registry.getAgent(agentId)
  const includeHidden = result.data.includeHidden === "true"

  if (!agent || (!includeHidden && agent.visibility === "hidden")) {
    return agentNotFound(c, agentId)
  }

  return c.json(serializeAgentDetail(agent, providerService))
})

agents.put("/runtime/agents/:agentId", async (c: Context) => {
  const registry = c.get("agentRegistry")
  const providerService = c.get("providerService")
  if (!registry.isInitialized()) {
    return registryUnavailable(c)
  }

  const body = await readJsonBody(c)
  const result = UserAgentUpdateRequestSchema.safeParse(body)
  if (!result.success) {
    return agentInvalidInput(c, result.error.issues)
  }

  const agentId = c.req.param("agentId")!

  try {
    const updatedAgent = await registry.updateUserAgent(agentId, result.data)
    if (!updatedAgent) {
      return agentNotFound(c, agentId)
    }

    return c.json(serializeAgentDetail(updatedAgent, providerService))
  } catch (error) {
    return agentMutationFailed(c, error)
  }
})

agents.delete("/runtime/agents/:agentId", async (c: Context) => {
  const registry = c.get("agentRegistry")
  if (!registry.isInitialized()) {
    return registryUnavailable(c)
  }

  const agentId = c.req.param("agentId")!

  try {
    const deleted = await registry.deleteUserAgent(agentId)
    if (!deleted) {
      return agentNotFound(c, agentId)
    }

    return c.json({
      agentId,
      deleted: true,
    })
  } catch (error) {
    return agentMutationFailed(c, error)
  }
})

agents.put("/runtime/agents/:agentId/model", async (c: Context) => {
  const registry = c.get("agentRegistry")
  const providerService = c.get("providerService")
  if (!registry.isInitialized()) {
    return registryUnavailable(c)
  }

  const agentId = c.req.param("agentId")!
  const agent = registry.getAgent(agentId)
  if (!agent || agent.visibility === "hidden") {
    return agentNotFound(c, agentId)
  }

  if (!registry.isModelBindingAllowed(agentId)) {
    return agentModelBindingNotAllowed(c, agentId, "only visible enabled internal primary agents can bind models")
  }

  const body = await c.req.json().catch(() => null)
  const result = AgentModelBindingUpdateRequestSchema.safeParse(body)
  if (!result.success) {
    return agentModelBindingInvalid(c, result.error.issues)
  }

  const provider = providerService.getProvider(result.data.providerId)
  if (!provider) {
    return agentModelBindingInvalid(c, [
      {
        path: ["providerId"],
        message: `Provider ${result.data.providerId} not found`,
      },
    ])
  }

  if (!provider.enabled) {
    return agentModelBindingInvalid(c, [
      {
        path: ["providerId"],
        message: `Provider ${provider.id} is disabled`,
      },
    ])
  }

  const model = providerService.getModel(result.data.providerId, result.data.modelId)
  if (!model) {
    return agentModelBindingInvalid(c, [
      {
        path: ["modelId"],
        message: `Model ${result.data.providerId}/${result.data.modelId} not found`,
      },
    ])
  }

  if (!model.enabled) {
    return agentModelBindingInvalid(c, [
      {
        path: ["modelId"],
        message: `Model ${result.data.providerId}/${result.data.modelId} is disabled`,
      },
    ])
  }

  const updatedAgent = await registry.setAgentModelBinding(agentId, result.data)
  if (!updatedAgent) {
    return agentModelBindingNotAllowed(c, agentId, "binding is not supported for this agent")
  }

  return c.json(serializeAgentDetail(updatedAgent, providerService))
})

agents.delete("/runtime/agents/:agentId/model", async (c: Context) => {
  const registry = c.get("agentRegistry")
  const providerService = c.get("providerService")
  if (!registry.isInitialized()) {
    return registryUnavailable(c)
  }

  const agentId = c.req.param("agentId")!
  const agent = registry.getAgent(agentId)
  if (!agent || agent.visibility === "hidden") {
    return agentNotFound(c, agentId)
  }

  if (!registry.isModelBindingAllowed(agentId)) {
    return agentModelBindingNotAllowed(c, agentId, "only visible enabled internal primary agents can clear model bindings")
  }

  const updatedAgent = await registry.clearAgentModelBinding(agentId)
  if (!updatedAgent) {
    return agentModelBindingNotAllowed(c, agentId, "binding is not supported for this agent")
  }

  return c.json(serializeAgentDetail(updatedAgent, providerService))
})

export default agents
