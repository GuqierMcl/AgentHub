import { z } from "zod"
import type { ModelMessage } from "ai"
import { AgentDefinitionSchema, type AgentDefinition } from "../agents"
import type { WorkspaceService } from "./workspace"
import type { RuntimePermissionService } from "./permissions"

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
  "waiting_approval",
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
  "orchestrator.plan.created",
  "task.group.started",
  "task.group.completed",
  "task.started",
  "task.completed",
  "task.failed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "permission.requested",
  "permission.approved",
  "permission.denied",
  "permission.cancelled",
  "message.delta",
  "message.completed",
  "agent.completed",
  "run.completed",
  "run.failed",
  "run.cancelled",
])
export type RunEventType = z.infer<typeof RunEventTypeSchema>

export const RunEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  type: RunEventTypeSchema,
  timestamp: z.string(),
  agentId: z.string().optional(),
  parentAgentId: z.string().optional(),
  parentTaskId: z.string().optional(),
  taskId: z.string().optional(),
  groupId: z.string().optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  data: z.unknown().optional(),
})
export type RunEvent = z.infer<typeof RunEventSchema>

export const OrchestratorRiskLevelSchema = z.enum(["low", "medium", "high"])
export type OrchestratorRiskLevel = z.infer<typeof OrchestratorRiskLevelSchema>

export const OrchestratorTaskSchema = z.object({
  taskId: z.string().min(1),
  targetAgentId: z.string().min(1),
  title: z.string().min(1),
  instruction: z.string().min(1),
  expectedOutput: z.string().min(1),
  requiredCapabilities: z.array(z.string()).default([]),
  riskLevel: OrchestratorRiskLevelSchema,
  dependsOn: z.array(z.string().min(1)).default([]),
})
export type OrchestratorTask = z.infer<typeof OrchestratorTaskSchema>

export const OrchestratorPlanSchema = z.object({
  intent: z.string().min(1),
  entryAgentId: z.string().min(1),
  tasks: z.array(OrchestratorTaskSchema),
  summaryInstruction: z.string().min(1),
})
export type OrchestratorPlan = z.infer<typeof OrchestratorPlanSchema>

export const TaskExecutionStatusSchema = z.enum([
  "completed",
  "failed",
  "cancelled",
])
export type TaskExecutionStatus = z.infer<typeof TaskExecutionStatusSchema>

export const TaskExecutionResultSchema = z.object({
  taskId: z.string().min(1),
  targetAgentId: z.string().min(1),
  status: TaskExecutionStatusSchema,
  summary: z.string(),
  dependsOn: z.array(z.string().min(1)).default([]),
  groupId: z.string().optional(),
  parentTaskId: z.string().optional(),
  data: z.unknown().optional(),
  events: z.array(RunEventSchema),
})
export type TaskExecutionResult = z.infer<typeof TaskExecutionResultSchema>

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
  task?: OrchestratorTask
  parentAgentId?: string
  groupId?: string
  parentTaskId?: string
  emitEvent?: (event: RunEvent) => void
  workspaceService?: WorkspaceService
  permissionService?: RuntimePermissionService
  resumeMessages?: ModelMessage[]
  onApprovalPending?: (messages: ModelMessage[]) => void
  executeTask?: (task: OrchestratorTask, options?: {
    groupId?: string
    parentTaskId?: string
  }) => Promise<TaskExecutionResult>
  runTask?: (task: OrchestratorTask, options?: {
    groupId?: string
    parentTaskId?: string
  }) => Promise<TaskExecutionResult>
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

