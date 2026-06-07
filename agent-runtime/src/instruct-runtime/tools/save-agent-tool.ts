import {
  DEFAULT_USER_AGENT_PERMISSION_POLICY,
  type AgentDefinition,
  type AgentToolPermissionRules,
} from "../../agents"
import type { AgentStore } from "../../agents"
import type { ToolDefinition, ToolExecutionResult } from "../../runtime/tools"
import {
  InstructSaveAgentInputSchema,
  type InstructSaveAgentInput,
  type InstructSaveAgentResult,
} from "../types"
import {
  normalizeAllowedToolsForInstruct,
  normalizePermissionPolicyForInstructAgent,
  normalizeUserToolPermissionRules,
  INSTRUCT_SYSTEM_PRESET_IDS,
  InstructPermissionError,
} from "../instruct-agent-authoring-policy"

const IMPLICIT_INSTRUCT_TOOLS = ["question"] as const

type SaveAgentToolOptions = {
  onSavedAgent?: (agent: AgentDefinition) => Promise<void> | void
}

export function createSaveAgentTool(
  agentStore: AgentStore,
  options: SaveAgentToolOptions = {}
): ToolDefinition<InstructSaveAgentInput, InstructSaveAgentResult> {
  return {
    name: "save_agent",
    displayName: "Save Agent",
    description: [
      "Save a new user-defined agent to the agent store.",
      "Use this when you have collected enough information to create the agent.",
      "Required fields: name, description, systemPrompt.",
    ].join(" "),
    category: "agent-authoring",
    inputSchema: InstructSaveAgentInputSchema,
    riskLevel: "medium",
    requiredPermissions: {},
    approvalPolicy: "never",
    configurableByUserAgent: false,
    internal: true,
    async execute(input): Promise<ToolExecutionResult<InstructSaveAgentResult>> {
      try {
        const existing = await agentStore.loadAgents()

        const generatedId = input.id ?? `agent_${crypto.randomUUID()}`

        if (INSTRUCT_SYSTEM_PRESET_IDS.has(generatedId)) {
          return {
            status: "failed",
            summary: `Agent id ${generatedId} is reserved for system presets`,
            error: {
              code: "AGENT_ALREADY_EXISTS",
              message: `Agent id ${generatedId} is reserved for a system preset`,
            },
          }
        }

        const idConflict = existing.find((a) => a.id === generatedId)
        if (idConflict) {
          return {
            status: "failed",
            summary: `Agent with id ${generatedId} already exists`,
            error: {
              code: "AGENT_ALREADY_EXISTS",
              message: `An agent with id ${generatedId} already exists`,
            },
          }
        }

        const allowedTools = normalizeAllowedToolsForInstruct(input.allowedTools)
        const permissionPolicy = normalizePermissionPolicyForInstructAgent(
          input.permissionPolicy as AgentDefinition["permissionPolicy"] | undefined,
          allowedTools
        )
        const toolPermissionRules = normalizeUserToolPermissionRules(
          input.toolPermissionRules as AgentToolPermissionRules | undefined
        )

        const now = new Date().toISOString()

        const agent: AgentDefinition = {
          id: generatedId,
          name: input.name,
          description: input.description,
          tier: "primary",
          origin: "user",
          visibility: "visible",
          entryPolicy: "callable",
          delegationPolicy: "can-delegate",
          executorType: "ai-sdk",
          systemPrompt: input.systemPrompt,
          capabilities: normalizeStringList(input.capabilities),
          allowedSubagents: normalizeStringList(input.allowedSubagents),
          allowedTools,
          allowedSkills: [],
          permissionPolicy,
          toolPermissionRules,
          enabled: true,
          readonly: false,
          createdAt: now,
          updatedAt: now,
        }

        existing.push(agent)
        await agentStore.saveAgents(existing)
        await options.onSavedAgent?.(structuredClone(agent))

        const result: InstructSaveAgentResult = {
          agent: {
            id: agent.id,
            name: agent.name,
            description: agent.description,
            capabilities: agent.capabilities,
            allowedTools: agent.allowedTools,
            allowedSubagents: agent.allowedSubagents,
            permissionPolicy: agent.permissionPolicy,
            enabled: agent.enabled,
            readonly: agent.readonly,
            createdAt: agent.createdAt,
            updatedAt: agent.updatedAt,
          },
        }

        return {
          status: "completed",
          summary: `Created agent ${generatedId}`,
          data: result,
        }
      } catch (error) {
        if (error instanceof InstructPermissionError) {
          return {
            status: "failed",
            summary: error.message,
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
            },
          }
        }

        const message = error instanceof Error ? error.message : "Unknown error saving agent"
        return {
          status: "failed",
          summary: message,
          error: {
            code: "AGENT_STORE_WRITE_FAILED",
            message,
          },
        }
      }
    },
  }
}

function normalizeStringList(values: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }

    seen.add(trimmed)
    normalized.push(trimmed)
  }

  return normalized
}
