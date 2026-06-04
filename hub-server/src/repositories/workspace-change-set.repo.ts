import { getPrismaClient } from '../lib/db'
import { generateId } from '../lib/id'
import { safeJsonParse } from '../lib/utils'

export type WorkspaceChangeAttributionKind = 'tool' | 'task' | 'agent' | 'run'
export type WorkspaceChangeAttributionConfidence = 'inferred' | 'aggregate' | 'ambiguous' | 'unknown'

export interface CreateWorkspaceChangeSetInput {
  id?: string
  conversationId: string
  runId: string
  artifactId: string
  sourceEventId: string
  status: string
  baselineDirty: boolean
  runOnlyReliable: boolean
  summary?: string | null
  statsJson?: Record<string, unknown>
  limitationsJson?: string[]
  attributionKind: WorkspaceChangeAttributionKind
  attributionConfidence: WorkspaceChangeAttributionConfidence
  agentId?: string | null
  taskId?: string | null
  toolCallId?: string | null
  toolName?: string | null
  messageId?: string | null
  metadataJson?: Record<string, unknown>
}

export interface CreateWorkspaceChangeSetFileInput {
  id?: string
  changeSetId: string
  conversationId: string
  runId: string
  artifactId: string
  path: string
  oldPath?: string | null
  statusBefore?: string | null
  statusAfter?: string | null
  origin?: string | null
  additions?: number | null
  deletions?: number | null
  binary?: boolean
  truncated?: boolean
  attributionKind: WorkspaceChangeAttributionKind
  attributionConfidence: WorkspaceChangeAttributionConfidence
  agentId?: string | null
  taskId?: string | null
  toolCallId?: string | null
  toolName?: string | null
  messageId?: string | null
  metadataJson?: Record<string, unknown>
}

export interface WorkspaceChangeSetOutput {
  id: string
  conversationId: string
  runId: string
  artifactId: string
  sourceEventId: string
  status: string
  baselineDirty: boolean
  runOnlyReliable: boolean
  summary: string | null
  statsJson: Record<string, unknown>
  limitationsJson: string[]
  attributionKind: WorkspaceChangeAttributionKind
  attributionConfidence: WorkspaceChangeAttributionConfidence
  agentId: string | null
  taskId: string | null
  toolCallId: string | null
  toolName: string | null
  messageId: string | null
  metadataJson: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface WorkspaceChangeSetFileOutput {
  id: string
  changeSetId: string
  conversationId: string
  runId: string
  artifactId: string
  path: string
  oldPath: string | null
  statusBefore: string | null
  statusAfter: string | null
  origin: string | null
  additions: number | null
  deletions: number | null
  binary: boolean
  truncated: boolean
  attributionKind: WorkspaceChangeAttributionKind
  attributionConfidence: WorkspaceChangeAttributionConfidence
  agentId: string | null
  taskId: string | null
  toolCallId: string | null
  toolName: string | null
  messageId: string | null
  metadataJson: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type WorkspaceChangeSetWithFilesOutput = WorkspaceChangeSetOutput & {
  files: WorkspaceChangeSetFileOutput[]
}

function toChangeSetOutput(record: Record<string, unknown>): WorkspaceChangeSetOutput {
  return {
    ...record,
    statsJson: safeJsonParse(record.statsJson as string | undefined, {}),
    limitationsJson: safeJsonParse(record.limitationsJson as string | undefined, []),
    metadataJson: safeJsonParse(record.metadataJson as string | undefined, {}),
  } as unknown as WorkspaceChangeSetOutput
}

function toChangeSetFileOutput(record: Record<string, unknown>): WorkspaceChangeSetFileOutput {
  return {
    ...record,
    metadataJson: safeJsonParse(record.metadataJson as string | undefined, {}),
  } as WorkspaceChangeSetFileOutput
}

function toChangeSetWithFilesOutput(record: Record<string, unknown>): WorkspaceChangeSetWithFilesOutput {
  const files = ((record.files as Record<string, unknown>[] | undefined) ?? [])
    .map(toChangeSetFileOutput)
  return {
    ...toChangeSetOutput(record),
    files,
  }
}

export async function createWorkspaceChangeSet(
  input: CreateWorkspaceChangeSetInput,
): Promise<WorkspaceChangeSetOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  const record = await db.workspaceChangeSet.create({
    data: {
      id: input.id ?? generateId('wcs'),
      conversationId: input.conversationId,
      runId: input.runId,
      artifactId: input.artifactId,
      sourceEventId: input.sourceEventId,
      status: input.status,
      baselineDirty: input.baselineDirty,
      runOnlyReliable: input.runOnlyReliable,
      summary: input.summary ?? null,
      statsJson: JSON.stringify(input.statsJson ?? {}),
      limitationsJson: JSON.stringify(input.limitationsJson ?? []),
      attributionKind: input.attributionKind,
      attributionConfidence: input.attributionConfidence,
      agentId: input.agentId ?? null,
      taskId: input.taskId ?? null,
      toolCallId: input.toolCallId ?? null,
      toolName: input.toolName ?? null,
      messageId: input.messageId ?? null,
      metadataJson: JSON.stringify(input.metadataJson ?? {}),
      createdAt: now,
      updatedAt: now,
    },
  })
  return toChangeSetOutput(record as Record<string, unknown>)
}

export async function createWorkspaceChangeSetFile(
  input: CreateWorkspaceChangeSetFileInput,
): Promise<WorkspaceChangeSetFileOutput> {
  const now = new Date().toISOString()
  const db = getPrismaClient()
  const record = await db.workspaceChangeSetFile.create({
    data: {
      id: input.id ?? generateId('wcf'),
      changeSetId: input.changeSetId,
      conversationId: input.conversationId,
      runId: input.runId,
      artifactId: input.artifactId,
      path: input.path,
      oldPath: input.oldPath ?? null,
      statusBefore: input.statusBefore ?? null,
      statusAfter: input.statusAfter ?? null,
      origin: input.origin ?? null,
      additions: input.additions ?? null,
      deletions: input.deletions ?? null,
      binary: input.binary ?? false,
      truncated: input.truncated ?? false,
      attributionKind: input.attributionKind,
      attributionConfidence: input.attributionConfidence,
      agentId: input.agentId ?? null,
      taskId: input.taskId ?? null,
      toolCallId: input.toolCallId ?? null,
      toolName: input.toolName ?? null,
      messageId: input.messageId ?? null,
      metadataJson: JSON.stringify(input.metadataJson ?? {}),
      createdAt: now,
      updatedAt: now,
    },
  })
  return toChangeSetFileOutput(record as Record<string, unknown>)
}

export async function findWorkspaceChangeSetBySourceEventId(
  sourceEventId: string,
): Promise<WorkspaceChangeSetOutput | null> {
  const db = getPrismaClient()
  const record = await db.workspaceChangeSet.findUnique({
    where: { sourceEventId },
  })
  if (!record) return null
  return toChangeSetOutput(record as Record<string, unknown>)
}

export async function findWorkspaceChangeSetByArtifactId(
  artifactId: string,
): Promise<WorkspaceChangeSetWithFilesOutput | null> {
  const db = getPrismaClient()
  const record = await db.workspaceChangeSet.findUnique({
    where: { artifactId },
    include: {
      files: { orderBy: [{ path: 'asc' }] },
    },
  })
  if (!record) return null
  return toChangeSetWithFilesOutput(record as Record<string, unknown>)
}

export async function listWorkspaceChangeSetFilesByChangeSet(
  changeSetId: string,
): Promise<WorkspaceChangeSetFileOutput[]> {
  const db = getPrismaClient()
  const records = await db.workspaceChangeSetFile.findMany({
    where: { changeSetId },
    orderBy: [{ path: 'asc' }],
  })
  return records.map((record) => toChangeSetFileOutput(record as Record<string, unknown>))
}
