import { z } from "zod"
import type { ModelMessage } from "ai"
import { AgentDefinitionSchema, type AgentDefinition } from "../agents"
import type { WorkspaceService } from "./workspace"
import type { RuntimePermissionService } from "./permissions"
import type { RuntimeEnvironmentSnapshot } from "./environment-snapshot"
import type {
  ExternalQuestionRequest,
  NormalizedQuestionAnswer,
  QuestionContinuationRequest,
} from "./question"

export const RuntimeConversationModeSchema = z.enum(["single", "group"])
export type RuntimeConversationMode = z.infer<typeof RuntimeConversationModeSchema>

export const RuntimeMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant", "system"]),
  agentId: z.string().optional(),
  content: z.string(),
})
export type RuntimeMessage = z.infer<typeof RuntimeMessageSchema>

export const RunWorkspaceSnapshotSchema = z.object({
  workspaceId: z.string().min(1),
  backendType: z.literal("local"),
  rootPath: z.string().min(1),
})
export type RunWorkspaceSnapshot = z.infer<typeof RunWorkspaceSnapshotSchema>

export const RunWorkspaceSummarySchema = z.object({
  workspaceId: z.string().min(1),
  backendType: z.literal("local"),
  rootLabel: z.string().min(1),
})
export type RunWorkspaceSummary = z.infer<typeof RunWorkspaceSummarySchema>

export const WorkspaceDiffFileOriginSchema = z.enum([
  "new-since-baseline",
  "removed-since-baseline",
  "status-changed",
  "unchanged-baseline",
  "unknown-dirty-baseline",
])
export type WorkspaceDiffFileOrigin = z.infer<typeof WorkspaceDiffFileOriginSchema>

export const WorkspaceDiffFileSchema = z.object({
  path: z.string().min(1),
  statusBefore: z.string().min(1).optional(),
  statusAfter: z.string().min(1).optional(),
  origin: WorkspaceDiffFileOriginSchema,
  additions: z.number().int().min(0).optional(),
  deletions: z.number().int().min(0).optional(),
  binary: z.boolean().optional(),
}).strict()
export type WorkspaceDiffFile = z.infer<typeof WorkspaceDiffFileSchema>

export const WorkspaceDiffStatsSchema = z.object({
  filesChanged: z.number().int().min(0),
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  modified: z.number().int().min(0),
  added: z.number().int().min(0),
  deleted: z.number().int().min(0),
  renamed: z.number().int().min(0),
  untracked: z.number().int().min(0),
  conflicted: z.number().int().min(0),
}).strict()
export type WorkspaceDiffStats = z.infer<typeof WorkspaceDiffStatsSchema>

export const WorkspaceDiffSnapshotSchema = z.object({
  capturedAt: z.string().min(1),
  repository: z.enum(["available", "not_repository", "unknown"]),
  branch: z.string().min(1).optional(),
  head: z.string().min(1).optional(),
  dirty: z.boolean(),
  fileCount: z.number().int().min(0),
  unavailableReason: z.string().min(1).optional(),
}).strict()
export type WorkspaceDiffSnapshot = z.infer<typeof WorkspaceDiffSnapshotSchema>

export const WorkspaceDiffPatchSchema = z.object({
  text: z.string(),
  bytes: z.number().int().min(0),
  maxBytes: z.number().int().min(1),
  truncated: z.boolean(),
  omittedReason: z.string().min(1).optional(),
}).strict()
export type WorkspaceDiffPatch = z.infer<typeof WorkspaceDiffPatchSchema>

export const WorkspaceDiffSummarySchema = z.object({
  version: z.literal(1),
  status: z.enum(["available", "degraded", "unavailable"]),
  source: z.literal("git"),
  workspace: RunWorkspaceSummarySchema.optional(),
  baseline: WorkspaceDiffSnapshotSchema,
  final: WorkspaceDiffSnapshotSchema,
  baselineDirty: z.boolean(),
  runOnlyReliable: z.boolean(),
  changedFiles: z.array(WorkspaceDiffFileSchema),
  stats: WorkspaceDiffStatsSchema,
  patch: WorkspaceDiffPatchSchema.optional(),
  summary: z.string(),
  limitations: z.array(z.string()).default([]),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }).strict().optional(),
}).strict()
export type WorkspaceDiffSummary = z.infer<typeof WorkspaceDiffSummarySchema>

export const RunDiagnosticsSchema = z.object({
  includeModelStream: z.boolean().optional(),
  includeReasoning: z.boolean().optional(),
  includeRawModelChunks: z.boolean().optional(),
}).strict()
export type RunDiagnostics = z.infer<typeof RunDiagnosticsSchema>

export const RunConversationStateSchema = z.object({
  messageCountBeforeRun: z.number().int().min(0).optional(),
  titleSource: z.enum(["default", "auto", "manual"]).optional(),
  titleSeedUserMessage: z.string().min(1).optional(),
}).strict()
export type RunConversationState = z.infer<typeof RunConversationStateSchema>

export const ExternalSessionScopeSchema = z.enum(["conversation-visible", "delegated-task"])
export type ExternalSessionScope = z.infer<typeof ExternalSessionScopeSchema>

export const ExternalSessionHintSchema = z.object({
  provider: z.enum(["opencode", "claude-code", "codex"]),
  agentId: z.string().min(1),
  scope: ExternalSessionScopeSchema,
  providerSessionId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  parentProviderSessionId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  handoffSummary: z.string().min(1).optional(),
}).strict()
export type ExternalSessionHint = z.infer<typeof ExternalSessionHintSchema>

export const ExternalContextMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  agentId: z.string().min(1).optional(),
  senderLabel: z.string().min(1).optional(),
  createdAt: z.string().min(1).optional(),
  content: z.string().min(1),
}).strict()
export type ExternalContextMessage = z.infer<typeof ExternalContextMessageSchema>

export const ExternalContextHandoffSummarySchema = z.object({
  sessionId: z.string().min(1).optional(),
  providerSessionId: z.string().min(1),
  taskId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  summary: z.string().min(1),
}).strict()
export type ExternalContextHandoffSummary = z.infer<typeof ExternalContextHandoffSummarySchema>

export const ExternalContextCursorCandidateSchema = z.object({
  throughMessageId: z.string().min(1).optional(),
  throughMessageCreatedAt: z.string().min(1).optional(),
  includedMessageIds: z.array(z.string().min(1)).default([]),
  includedHandoffSessionIds: z.array(z.string().min(1)).default([]),
}).strict()
export type ExternalContextCursorCandidate = z.infer<typeof ExternalContextCursorCandidateSchema>

export const ExternalContextOmittedSchema = z.object({
  messageCount: z.number().int().min(0).optional(),
  characterCount: z.number().int().min(0).optional(),
  handoffSummaryCount: z.number().int().min(0).optional(),
}).strict()
export type ExternalContextOmitted = z.infer<typeof ExternalContextOmittedSchema>

export const ExternalContextPacketSchema = z.object({
  provider: z.enum(["opencode", "claude-code", "codex"]),
  agentId: z.string().min(1),
  scope: ExternalSessionScopeSchema,
  mode: z.enum(["delta", "bootstrap"]),
  messages: z.array(ExternalContextMessageSchema).default([]),
  handoffSummaries: z.array(ExternalContextHandoffSummarySchema).default([]),
  cursorCandidate: ExternalContextCursorCandidateSchema.optional(),
  omitted: ExternalContextOmittedSchema.optional(),
}).strict()
export type ExternalContextPacket = z.infer<typeof ExternalContextPacketSchema>

export const PinnedMessageSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  content: z.string(),
  note: z.string().nullable().optional(),
  pinnedAt: z.string(),
  sortOrder: z.number(),
})
export type PinnedMessage = z.infer<typeof PinnedMessageSchema>

export const RunInputSchema = z.object({
  conversationId: z.string().min(1),
  mode: RuntimeConversationModeSchema,
  participantAgentIds: z.array(z.string().min(1)).min(1),
  addressedAgentIds: z.array(z.string().min(1)).optional(),
  userMessage: RuntimeMessageSchema.extend({
    role: z.literal("user"),
  }),
  history: z.array(RuntimeMessageSchema).default([]),
  workspace: RunWorkspaceSnapshotSchema.optional(),
  diagnostics: RunDiagnosticsSchema.optional(),
  conversationState: RunConversationStateSchema.optional(),
  externalSessionHints: z.array(ExternalSessionHintSchema).optional(),
  externalContext: z.array(ExternalContextPacketSchema).optional(),
  pinnedMessages: z.array(PinnedMessageSchema).optional(),
})
export type RunInput = z.infer<typeof RunInputSchema>

export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "waiting_input",
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
  "question.requested",
  "question.answered",
  "question.cancelled",
  "model.stream.part",
  "reasoning.started",
  "reasoning.delta",
  "reasoning.completed",
  "message.delta",
  "message.completed",
  "agent.completed",
  "system_agent.completed",
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
  messageId: z.string().optional(),
  messageIndex: z.number().int().min(0).optional(),
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

export type RunRecordResponse = Omit<RunRecord, "input"> & {
  input: Omit<RunInput, "workspace"> & {
    workspace?: RunWorkspaceSummary
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
  modelSourceAgent?: AgentDefinition
  groupId?: string
  parentTaskId?: string
  emitEvent?: (event: RunEvent) => void
  workspaceService?: WorkspaceService
  permissionService?: RuntimePermissionService
  environmentSnapshot?: RuntimeEnvironmentSnapshot
  executionId?: string
  resumeMessages?: ModelMessage[]
  onApprovalPending?: (messages: ModelMessage[]) => void
  onQuestionPending?: (request: QuestionContinuationRequest) => boolean
  requestExternalQuestion?: (request: ExternalQuestionRequest) => Promise<NormalizedQuestionAnswer[]>
  executeTask?: (task: OrchestratorTask, options?: {
    groupId?: string
    parentTaskId?: string
  }) => Promise<TaskExecutionResult>
  runTask?: (task: OrchestratorTask, options?: {
    groupId?: string
    parentTaskId?: string
  }) => Promise<TaskExecutionResult>
  createMessageId?: () => string
  getCurrentMessageId?: () => string
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
  input: RunInputSchema.omit({ workspace: true }).extend({
    workspace: RunWorkspaceSummarySchema.optional(),
  }),
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

export { AgentDefinitionSchema }
