import type { RuntimeRunEvent, RuntimeRunStatus } from "./runtime-runs"
import type {
  ChatImageAttachment,
  ChatImageAttachmentInput,
} from "../types"

export type PersistedMessagePart = {
  id: string
  messageId: string
  conversationId: string
  runId: string | null
  runtimeEventId: string | null
  partKey: string
  partIndex: number
  entityType: string | null
  entityId: string | null
  type: string
  state: string
  text: string | null
  payloadJson: Record<string, unknown>
  firstEventSequence: number | null
  lastEventSequence: number | null
  createdAt: string
  updatedAt: string
}

export type PersistedArtifactVersion = {
  id: string
  artifactId: string
  version: number
  source: string
  language: string | null
  content: string
  summary: string | null
  diffJson: Record<string, unknown> | null
  createdByAgentId: string | null
  createdAt: string
}

export type PersistedArtifact = {
  id: string
  conversationId: string
  runId: string | null
  messageId: string | null
  createdByAgentId: string | null
  type: string
  title: string
  status: string
  currentVersionId: string | null
  metadataJson: Record<string, unknown>
  createdAt: string
  updatedAt: string
  currentVersion?: PersistedArtifactVersion | null
}

export type MessageReplySnapshot = {
  messageId: string
  role: "user" | "assistant"
  senderType: string
  senderId: string | null
  agentId: string | null
  createdAt: string
  excerpt: string
}

export type MessageRegenerateSnapshot = {
  sourceAssistantMessageId: string
  sourceRunId: string
  sourceTriggerMessageId: string
  sourceAssistantAgentId: string | null
  sourceAssistantCreatedAt: string
  sourceAssistantExcerpt: string
}

export type DiffFileSummary = {
  path: string
  oldPath?: string
  status: string
  additions?: number
  deletions?: number
  binary?: boolean
  truncated?: boolean
  attribution?: WorkspaceChangeAttribution
}

export type WorkspaceChangeAttribution = {
  kind: "tool" | "task" | "agent" | "run"
  confidence: "inferred" | "aggregate" | "ambiguous" | "unknown"
  agentId?: string
  taskId?: string
  toolCallId?: string
  toolName?: string
  messageId?: string
  candidateToolCallIds?: string[]
  candidateAgentIds?: string[]
  candidateTaskIds?: string[]
}

export type WorkspaceChangeSetFileDetail = {
  id: string
  path: string
  oldPath?: string
  statusBefore?: string
  statusAfter?: string
  origin?: string
  additions?: number
  deletions?: number
  binary?: boolean
  truncated?: boolean
  attribution: WorkspaceChangeAttribution
}

export type WorkspaceChangeSetDetail = {
  id: string
  attribution: WorkspaceChangeAttribution
  files: WorkspaceChangeSetFileDetail[]
  summary: string | null
  status: string
  baselineDirty: boolean
  runOnlyReliable: boolean
}

export type DiffArtifactOperation = {
  type: "revert"
  status: "applied"
  revertsArtifactId: string
  revertsChangeSetId?: string
  patchDirection: "reverse-applied"
}

export type DiffArtifactDetail = {
  summary: Record<string, unknown>
  changedFiles: DiffFileSummary[]
  patchText: string
  patchTruncated: boolean
  baselineDirty: boolean
  runOnlyReliable: boolean
  limitations: string[]
  changeSet?: WorkspaceChangeSetDetail
  operation?: DiffArtifactOperation
}

export type ArtifactDetailResponse = {
  artifact: PersistedArtifact
  currentVersion: PersistedArtifactVersion | null
  diff?: DiffArtifactDetail
}

export type ArtifactRevertPreviewResponse = {
  status: "available" | "blocked"
  canApply: boolean
  files: Array<Record<string, unknown>>
  warnings: string[]
  blockedReason?: Record<string, unknown>
  source: {
    artifactId: string
    changeSetId?: string
    runId: string
    patchDirection: "reverse-applied"
  }
}

export type ArtifactRevertApplyResponse = {
  status: "applied" | "already_applied" | "blocked" | "failed"
  message: string
  artifact?: PersistedArtifact
  currentVersion?: PersistedArtifactVersion | null
  diff?: DiffArtifactDetail
  changeSet?: WorkspaceChangeSetDetail
  preview?: ArtifactRevertPreviewResponse
  blockedReason?: Record<string, unknown>
  error?: Record<string, unknown>
}

export type PersistedMessage = {
  id: string
  conversationId: string
  runId: string | null
  runtimeMessageId: string | null
  runtimeRunId: string | null
  messageIndex: number | null
  surface: string
  role: "user" | "assistant" | "system"
  senderType: string
  senderId: string | null
  agentId: string | null
  taskId: string | null
  groupId: string | null
  parentMessageId: string | null
  regeneratedFromId: string | null
  status: "created" | "streaming" | "completed" | "failed" | "cancelled"
  finishReason: string | null
  firstEventSequence: number | null
  lastEventSequence: number | null
  metadataJson: Record<string, unknown>
  uiMessageJson: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  parts: PersistedMessagePart[]
  artifacts?: PersistedArtifact[]
}

export type ActiveRunSnapshot = {
  id: string
  runtimeId: string | null
  status: RuntimeRunStatus
  lastEventSequence: number
  plan: Record<string, unknown> | null
}

export type RunPlanSnapshot = {
  runId: string
  status: RuntimeRunStatus
  plan: Record<string, unknown>
  updatedAt: string
  completedAt: string | null
}

export type ConversationRunItemsSnapshot = {
  toolCalls: Record<string, unknown>[]
  reasoningBlocks: Record<string, unknown>[]
  taskGroups: Record<string, unknown>[]
  tasks: Record<string, unknown>[]
  plans: Record<string, unknown>[]
  planTasks: Record<string, unknown>[]
  permissionRequests: Record<string, unknown>[]
}

export type HubRunEventEnvelope = {
  sequence: number
  event: RuntimeRunEvent
}

export type ConversationTimelineRunSnapshot = {
  run: {
    id: string
    runtimeId: string | null
    status: RuntimeRunStatus
    triggerMessageId: string
    createdAt: string
    lastEventSequence: number
  }
  triggerMessage: PersistedMessage | null
  events: HubRunEventEnvelope[]
}

export type ConversationMessagesResponse = {
  messages: PersistedMessage[]
  activeRun: ActiveRunSnapshot | null
  latestPlan: RunPlanSnapshot | null
  runItems: ConversationRunItemsSnapshot
  timelineRuns: ConversationTimelineRunSnapshot[]
}

export type PermissionDecisionBody = {
  approved: boolean
  reason?: string
}

export type QuestionAnswerBody = {
  answers: Array<{
    questionId: string
    optionId?: string
    answer?: string
    custom?: boolean
  }>
}

export type SendConversationMessageOptions = {
  addressedAgentIds?: string[]
  replyToMessageId?: string
  attachments?: Array<Pick<ChatImageAttachment, "kind" | "assetId">>
}

type ErrorBody = {
  error?: {
    code?: string
    message?: string
    details?: unknown
  }
}

const IMAGE_ATTACHMENT_READ_FAILED = "IMAGE_ATTACHMENT_READ_FAILED"

export class ConversationMessageRequestError extends Error {
  code?: string
  details?: unknown

  constructor(message: string, code?: string, details?: unknown) {
    super(message)
    this.name = "ConversationMessageRequestError"
    this.code = code
    this.details = details
  }
}

async function readErrorBody(res: Response): Promise<ErrorBody> {
  return res.json().catch(() => ({})) as Promise<ErrorBody>
}

async function readJsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await readErrorBody(res)
    const message = body.error?.message ?? `请求失败 (${res.status})`
    throw new ConversationMessageRequestError(
      message,
      body.error?.code,
      body.error?.details
    )
  }

  return res.json()
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  })

  return readJsonResponse(res)
}

async function filePartUrlToBlob(
  filePart: ChatImageAttachmentInput
): Promise<Blob> {
  try {
    const response = await fetch(filePart.url)
    if (!response.ok) {
      throw new ConversationMessageRequestError(
        `无法读取待上传图片 (${response.status})`,
        IMAGE_ATTACHMENT_READ_FAILED
      )
    }

    const blob = await response.blob()
    if (!filePart.mediaType || blob.type === filePart.mediaType) {
      return blob
    }

    return new Blob([blob], { type: filePart.mediaType })
  } catch (err) {
    if (err instanceof ConversationMessageRequestError) {
      throw err
    }
    throw new ConversationMessageRequestError(
      "无法读取待上传图片",
      IMAGE_ATTACHMENT_READ_FAILED,
      err
    )
  }
}

function getUploadFilename(filePart: ChatImageAttachmentInput): string {
  const filename = filePart.filename?.trim()
  if (filename) return filename

  const extension = getImageExtension(filePart.mediaType)
  return `image.${extension}`
}

function getImageExtension(mediaType: string): string {
  switch (mediaType.toLowerCase()) {
    case "image/jpeg":
      return "jpg"
    case "image/png":
      return "png"
    case "image/webp":
      return "webp"
    case "image/gif":
      return "gif"
    default:
      return "bin"
  }
}

export const conversationMessagesApi = {
  list(conversationId: string): Promise<ConversationMessagesResponse> {
    return request(`/api/conversations/${encodeURIComponent(conversationId)}/messages`)
  },

  artifactDetail(
    conversationId: string,
    artifactId: string
  ): Promise<ArtifactDetailResponse> {
    return request(
      `/api/conversations/${encodeURIComponent(conversationId)}/artifacts/${encodeURIComponent(artifactId)}`
    )
  },

  previewArtifactRevert(
    conversationId: string,
    artifactId: string
  ): Promise<ArtifactRevertPreviewResponse> {
    return request(
      `/api/conversations/${encodeURIComponent(conversationId)}/artifacts/${encodeURIComponent(artifactId)}/revert/preview`,
      { method: "POST" }
    )
  },

  applyArtifactRevert(
    conversationId: string,
    artifactId: string
  ): Promise<ArtifactRevertApplyResponse> {
    return request(
      `/api/conversations/${encodeURIComponent(conversationId)}/artifacts/${encodeURIComponent(artifactId)}/revert`,
      { method: "POST" }
    )
  },

  async uploadImage(
    conversationId: string,
    filePart: ChatImageAttachmentInput
  ): Promise<ChatImageAttachment> {
    const blob = await filePartUrlToBlob(filePart)
    const formData = new FormData()
    formData.append("file", blob, getUploadFilename(filePart))

    const res = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/assets/images`,
      {
        method: "POST",
        body: formData,
      }
    )

    return readJsonResponse<ChatImageAttachment>(res)
  },

  send(
    conversationId: string,
    content: string,
    options?: SendConversationMessageOptions
  ): Promise<ConversationMessagesResponse> {
    const addressedAgentIds = options?.addressedAgentIds?.filter(Boolean) ?? []
    const body = {
      content,
      ...(addressedAgentIds.length ? { addressedAgentIds } : {}),
      ...(options?.replyToMessageId ? { replyToMessageId: options.replyToMessageId } : {}),
      ...(options?.attachments?.length ? { attachments: options.attachments } : {}),
    }

    return request(`/api/conversations/${encodeURIComponent(conversationId)}/messages/send`, {
      method: "POST",
      body: JSON.stringify(body),
    })
  },

  regenerate(
    conversationId: string,
    messageId: string
  ): Promise<ConversationMessagesResponse> {
    return request(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/regenerate`,
      { method: "POST" }
    )
  },

  cancelRun(runId: string): Promise<ActiveRunSnapshot> {
    return request(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
    })
  },

  decidePermission(
    runId: string,
    requestId: string,
    decision: PermissionDecisionBody
  ): Promise<unknown> {
    return request(
      `/api/runs/${encodeURIComponent(runId)}/permissions/${encodeURIComponent(requestId)}/decision`,
      {
        method: "POST",
        body: JSON.stringify(decision),
      }
    )
  },

  answerQuestion(
    runId: string,
    requestId: string,
    body: QuestionAnswerBody
  ): Promise<unknown> {
    return request(
      `/api/runs/${encodeURIComponent(runId)}/questions/${encodeURIComponent(requestId)}/answer`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    )
  },

  eventsUrl(runId: string, afterSequence = 0): string {
    const search = new URLSearchParams({
      afterSequence: String(afterSequence),
    })
    return `/api/runs/${encodeURIComponent(runId)}/events?${search}`
  },
}

// --- Message Pin API ---

export type MessagePin = {
  id: string
  conversationId: string
  messageId: string
  messageContent?: string | null
  note: string | null
  sortOrder: number
  createdAt: string
}

export const messagePinApi = {
  list(conversationId: string): Promise<{ pins: MessagePin[] }> {
    return request(`/api/conversations/${encodeURIComponent(conversationId)}/pins`)
  },

  create(conversationId: string, messageId: string, note?: string): Promise<MessagePin> {
    return request(`/api/conversations/${encodeURIComponent(conversationId)}/pins`, {
      method: "POST",
      body: JSON.stringify({ messageId, ...(note ? { note } : {}) }),
    })
  },

  delete(pinId: string): Promise<{ deleted: boolean }> {
    return request(`/api/pins/${encodeURIComponent(pinId)}`, {
      method: "DELETE",
    })
  },

  update(pinId: string, data: { note?: string | null; sortOrder?: number }): Promise<MessagePin> {
    return request(`/api/pins/${encodeURIComponent(pinId)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    })
  },
}
