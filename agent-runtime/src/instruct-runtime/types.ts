import { z } from "zod"
import { AgentPermissionPolicySchema, AgentToolPermissionRulesSchema } from "../agents"

export const InstructRunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_input",
  "completed",
  "failed",
  "cancelled",
])
export type InstructRunStatus = z.infer<typeof InstructRunStatusSchema>

export const InstructAgentDraftSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  allowedTools: z.array(z.string()).optional(),
  allowedSubagents: z.array(z.string()).optional(),
  permissionPolicy: AgentPermissionPolicySchema.partial().optional(),
}).strict()
export type InstructAgentDraft = z.infer<typeof InstructAgentDraftSchema>

export const InstructRunDiagnosticsSchema = z.object({
  includeModelStream: z.boolean().optional(),
  includeReasoning: z.boolean().optional(),
  includeRawModelChunks: z.boolean().optional(),
}).strict()
export type InstructRunDiagnostics = z.infer<typeof InstructRunDiagnosticsSchema>

export const InstructRunInputSchema = z.object({
  conversationId: z.string().min(1),
  userMessage: z.object({
    role: z.literal("user"),
    content: z.string().min(1),
  }).strict(),
  history: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
    }).strict()
  ).default([]),
  draft: InstructAgentDraftSchema.optional(),
  diagnostics: InstructRunDiagnosticsSchema.optional(),
})
export type InstructRunInput = z.infer<typeof InstructRunInputSchema>

export const InstructSaveAgentInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000),
  systemPrompt: z.string().trim().min(1).max(20000),
  capabilities: z.array(z.string().trim().min(1).max(80)).default([]),
  allowedTools: z.array(z.string().trim().min(1)).default([]),
  allowedSubagents: z.array(z.string().trim().min(1)).default([]),
  permissionPolicy: AgentPermissionPolicySchema.partial().optional(),
  toolPermissionRules: AgentToolPermissionRulesSchema.optional(),
}).strict()
export type InstructSaveAgentInput = z.infer<typeof InstructSaveAgentInputSchema>

export const InstructSaveAgentResultSchema = z.object({
  agent: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    capabilities: z.array(z.string()),
    allowedTools: z.array(z.string()),
    allowedSubagents: z.array(z.string()),
    permissionPolicy: AgentPermissionPolicySchema,
    enabled: z.boolean(),
    readonly: z.boolean(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  }),
})
export type InstructSaveAgentResult = z.infer<typeof InstructSaveAgentResultSchema>

export type InstructRunRecord = {
  runId: string
  conversationId: string
  status: InstructRunStatus
  agentId: string
  createdAt: string
  updatedAt: string
  input: InstructRunInput
  error?: {
    code: string
    message: string
  }
}

export type InstructRunCreateResponse = {
  runId: string
  status: "queued"
  agentId: "instruct-agent"
  eventsUrl: string
}
