import { z } from "zod"
import { AgentDefinitionSchema, type AgentDefinition } from "../agents"

export const RuntimeConversationModeSchema = z.enum(["single", "group"])
export type RuntimeConversationMode = z.infer<typeof RuntimeConversationModeSchema>

export const RuntimeMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant", "system"]),
  agentId: z.string().optional(),
  content: z.string(),
})
export type RuntimeMessage = z.infer<typeof RuntimeMessageSchema>

export const RunInputSchema = z.object({
  conversationId: z.string().min(1),
  mode: RuntimeConversationModeSchema,
  participantAgentIds: z.array(z.string().min(1)).min(1),
  addressedAgentIds: z.array(z.string().min(1)).optional(),
  userMessage: RuntimeMessageSchema.extend({
    role: z.literal("user"),
  }),
  history: z.array(RuntimeMessageSchema).default([]),
})
export type RunInput = z.infer<typeof RunInputSchema>

export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
])
export type RunStatus = z.infer<typeof RunStatusSchema>

export const EntryReasonSchema = z.enum([
  "single_participant",
  "group_default_orchestrator",
  "group_addressed_agent",
])
export type EntryReason = z.infer<typeof EntryReasonSchema>

export const RunEventTypeSchema = z.enum([
  "run.started",
  "agent.entry.resolved",
  "agent.started",
  "message.delta",
  "message.completed",
  "agent.completed",
  "run.completed",
  "run.failed",
  "run.cancelled",
])
export type RunEventType = z.infer<typeof RunEventTypeSchema>

export type RunEvent = {
  id: string
  runId: string
  type: RunEventType
  timestamp: string
  agentId?: string
  data?: unknown
}

export type RunRecord = {
  id: string
  status: RunStatus
  input: RunInput
  entryAgentIds: string[]
  entryReason: EntryReason
  createdAt: string
  updatedAt: string
  error?: {
    code: string
    message: string
    details?: unknown
  }
}

export type EntryResolution = {
  entryAgentIds: string[]
  entryReason: EntryReason
  entryAgents: AgentDefinition[]
}

export type AgentExecutionContext = {
  runId: string
  input: RunInput
  agent: AgentDefinition
  signal: AbortSignal
}

export type AgentExecutor = {
  executorType: AgentDefinition["executorType"]
  execute(context: AgentExecutionContext): AsyncIterable<RunEvent>
}

export const RunCreateResponseSchema = z.object({
  runId: z.string(),
  status: RunStatusSchema,
  entryAgentIds: z.array(z.string()),
  entryReason: EntryReasonSchema,
  eventsUrl: z.string(),
})
export type RunCreateResponse = z.infer<typeof RunCreateResponseSchema>

export const RunRecordResponseSchema = z.object({
  id: z.string(),
  status: RunStatusSchema,
  input: RunInputSchema,
  entryAgentIds: z.array(z.string()),
  entryReason: EntryReasonSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }).optional(),
})
export type RunRecordResponse = z.infer<typeof RunRecordResponseSchema>

export { AgentDefinitionSchema }

