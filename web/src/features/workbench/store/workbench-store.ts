import { create } from "zustand"

import { useTabStore } from "@/store/tab-store"

import type {
  ActiveRunSnapshot,
  ConversationTimelineRunSnapshot,
  HubRunEventEnvelope,
  MessageRegenerateSnapshot,
  MessageReplySnapshot,
  PersistedArtifact,
  PersistedMessage,
} from "../api/messages"
import type { RuntimeRunEvent, RuntimeRunStatus } from "../api/runtime-runs"
import {
  applyRuntimeEventToTimeline,
  createLocalRunStatusItem,
  createLocalUserTimelineItem,
} from "../runtime/timeline-projection"
import type {
  Artifact,
  ArtifactKind,
  DeploymentCommandSnapshot,
  DeploymentConnectionStatus,
  DeploymentLogSnapshot,
  DeploymentSnapshot,
  WorkbenchMessageAttachment,
  WorkbenchTimelineItem,
  WorkbenchTimelineChatMessageItem,
  WorkbenchTimelinePlanItem,
  WorkbenchTimelineStatus,
  WorkbenchTimelineToolItem,
} from "../types"
import {
  formatWorkspaceDiffDescription,
  formatWorkspaceDiffMeta,
  formatWorkspaceDiffTitle,
} from "../utils/workspace-diff-copy"

export type RunConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"

type ConversationRuntimeState = {
  draft: string
  timelineItems: WorkbenchTimelineItem[]
  deploymentSnapshot: DeploymentSnapshot | null
  activeRuntimeRunId: string | null
  runStatus: RuntimeRunStatus | "idle" | "submitted"
  connectionStatus: RunConnectionStatus
  chatSpeakerIds: Record<string, true>
  receivedEventIds: Set<string>
  events: RuntimeRunEvent[]
}

type WorkbenchStore = {
  activeConversationId: string | null
  conversations: Record<string, ConversationRuntimeState>
  setActiveConversationId: (conversationId: string | null) => void
  setConversationChatSpeakers: (conversationId: string, speakerIds: string[]) => void
  setDraft: (conversationId: string, draft: string) => void
  hydrateTimelineFromReplay: (
    conversationId: string,
    messages: PersistedMessage[],
    timelineRuns: ConversationTimelineRunSnapshot[],
    activeRun: ActiveRunSnapshot | null
  ) => void
  applySendAck: (
    conversationId: string,
    triggerMessage: PersistedMessage,
    activeRun: ActiveRunSnapshot
  ) => void
  prependHistoryPage: (
    conversationId: string,
    messages: PersistedMessage[],
    timelineRuns: ConversationTimelineRunSnapshot[]
  ) => void
  addUserMessage: (conversationId: string, content: string) => WorkbenchTimelineItem[]
  markRunSubmitted: (conversationId: string) => void
  startRuntimeRun: (conversationId: string, runId: string, status: RuntimeRunStatus) => void
  applyHubRunStatus: (
    conversationId: string,
    runId: string,
    status: RuntimeRunStatus
  ) => void
  applyRuntimeEvent: (conversationId: string, event: RuntimeRunEvent) => void
  applyRuntimeEvents: (conversationId: string, events: RuntimeRunEvent[]) => void
  applyRuntimeEventEnvelopes: (
    conversationId: string,
    envelopes: HubRunEventEnvelope[],
    options?: { source?: "live" | "replay" }
  ) => void
  failRunStart: (conversationId: string, message: string, code?: string) => void
  setConnectionStatus: (conversationId: string, status: RunConnectionStatus) => void
  getConversationState: (conversationId: string) => ConversationRuntimeState
}

const terminalRunStatuses = new Set(["completed", "failed", "cancelled"])
const maxEventLogSize = 200
const persistedImageMediaTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
])

const timelineEventTypes = new Set([
  "message.delta",
  "message.completed",
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
  "reasoning.started",
  "reasoning.delta",
  "reasoning.completed",
  "agent.completed",
  "orchestrator.plan.created",
  "run.completed",
  "run.failed",
  "run.cancelled",
])

const runStatusByEventType: Partial<Record<string, RuntimeRunStatus>> = {
  "run.started": "running",
  "run.completed": "completed",
  "run.cancelled": "cancelled",
  "run.failed": "failed",
  "question.requested": "waiting_input",
  "question.answered": "running",
  "question.cancelled": "running",
}

function createEmptyConversationState(): ConversationRuntimeState {
  return {
    draft: "",
    timelineItems: [],
    deploymentSnapshot: null,
    activeRuntimeRunId: null,
    runStatus: "idle",
    connectionStatus: "idle",
    chatSpeakerIds: {},
    receivedEventIds: new Set(),
    events: [],
  }
}

function getOrCreateState(
  conversations: Record<string, ConversationRuntimeState>,
  conversationId: string
): ConversationRuntimeState {
  return conversations[conversationId] ?? createEmptyConversationState()
}

export function isTerminalRunStatus(status: RuntimeRunStatus | "idle" | "submitted"): boolean {
  return terminalRunStatuses.has(status)
}

export const useWorkbenchStore = create<WorkbenchStore>((set, get) => ({
  activeConversationId: null,
  conversations: {},

  setActiveConversationId: (conversationId) => {
    set({ activeConversationId: conversationId })
  },

  setConversationChatSpeakers: (conversationId, speakerIds) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            chatSpeakerIds: Object.fromEntries(
              speakerIds.map((speakerId) => [speakerId, true])
            ),
          },
        },
      }
    })
  },

  setDraft: (conversationId, draft) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            draft,
          },
        },
      }
    })
  },

  addUserMessage: (conversationId, content) => {
    const message = createLocalUserTimelineItem(content)

    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      const nextTimelineItems = [...current.timelineItems, message]
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            draft: "",
            timelineItems: nextTimelineItems,
          },
        },
      }
    })

    return get().getConversationState(conversationId).timelineItems
  },

  markRunSubmitted: (conversationId) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            runStatus: "submitted",
            connectionStatus: "connecting",
          },
        },
      }
    })
  },

  startRuntimeRun: (conversationId, runId, status) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            activeRuntimeRunId: runId,
            runStatus: status,
            connectionStatus: "connecting",
            receivedEventIds: new Set(),
            events: [],
          },
        },
      }
    })
  },

  applyHubRunStatus: (conversationId, runId, status) => {
    set((state) => {
      const current = state.conversations[conversationId]
      if (!current) return state
      if (
        current.activeRuntimeRunId &&
        current.activeRuntimeRunId !== runId
      ) {
        return state
      }

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            activeRuntimeRunId: current.activeRuntimeRunId ?? runId,
            runStatus: status,
            connectionStatus: isTerminalRunStatus(status)
              ? "disconnected"
              : current.connectionStatus,
          },
        },
      }
    })
  },

  hydrateTimelineFromReplay: (conversationId, messages, timelineRuns, activeRun) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      const activeRuntimeRunId = activeRun?.id ?? null
      const runStatus = activeRun?.status ?? "idle"
      const replayed = replayTimelineRuns(
        timelineRuns,
        messages,
        current.chatSpeakerIds
      )
      const replayIsBehindCurrentRun = hasUnreplayedCurrentRunEvents(
        current,
        replayed
      )

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            activeRuntimeRunId: replayIsBehindCurrentRun
              ? current.activeRuntimeRunId
              : activeRuntimeRunId,
            runStatus: replayIsBehindCurrentRun ? current.runStatus : runStatus,
            connectionStatus: replayIsBehindCurrentRun
              ? current.connectionStatus
              : activeRun ? current.connectionStatus : "idle",
            timelineItems: replayIsBehindCurrentRun
              ? current.timelineItems
              : replayed.timelineItems,
            deploymentSnapshot: replayIsBehindCurrentRun
              ? current.deploymentSnapshot
              : replayed.deploymentSnapshot,
            receivedEventIds: replayIsBehindCurrentRun
              ? current.receivedEventIds
              : replayed.receivedEventIds,
            events: replayIsBehindCurrentRun ? current.events : replayed.events,
          },
        },
      }
    })
  },

  applySendAck: (conversationId, triggerMessage, activeRun) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      const nextTimelineItems = mergePersistedChatMessages(
        current.timelineItems,
        [triggerMessage]
      )
      const nextConnectionStatus: RunConnectionStatus = isTerminalRunStatus(activeRun.status)
        ? "disconnected"
        : "connecting"

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            activeRuntimeRunId: activeRun.id,
            runStatus: activeRun.status,
            connectionStatus: nextConnectionStatus,
            timelineItems: nextTimelineItems,
            receivedEventIds: new Set(),
            events: [],
          },
        },
      }
    })
  },

  prependHistoryPage: (conversationId, messages, timelineRuns) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      const replayed = replayHistoryPage(
        timelineRuns,
        messages,
        current.chatSpeakerIds
      )
      const timelineItems = prependOlderTimelineItems(
        current.timelineItems,
        replayed.timelineItems
      )

      if (timelineItems === current.timelineItems) {
        return state
      }

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            timelineItems,
          },
        },
      }
    })
  },

  applyRuntimeEvent: (conversationId, event) => {
    get().applyRuntimeEvents(conversationId, [event])
  },

  applyRuntimeEvents: (conversationId, events) => {
    get().applyRuntimeEventEnvelopes(
      conversationId,
      events.map((event) => ({ sequence: 0, event })),
      { source: "live" }
    )
  },

  applyRuntimeEventEnvelopes: (conversationId, envelopes, options) => {
    if (envelopes.length === 0) return

    const source = options?.source ?? "live"
    let planFocusReasonKey: string | null = null
    let deploymentFocusReasonKey: string | null = null
    let deploymentPreviewRequest: { url: string; label?: string } | null = null

    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      const next = applyEnvelopesToRuntimeState(
        current,
        envelopes,
        current.chatSpeakerIds,
        source
      )
      planFocusReasonKey = next.planFocusReasonKey
      deploymentFocusReasonKey = next.deploymentFocusReasonKey
      deploymentPreviewRequest = next.deploymentPreviewRequest

      if (!next.changed) {
        return state
      }

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            activeRuntimeRunId: next.activeRuntimeRunId,
            runStatus: next.runStatus,
            connectionStatus: next.connectionStatus,
            timelineItems: next.timelineItems,
            deploymentSnapshot: next.deploymentSnapshot,
            receivedEventIds: next.receivedEventIds,
            events: next.events,
          },
        },
      }
    })

    if (
      source === "live" &&
      planFocusReasonKey &&
      get().activeConversationId === conversationId
    ) {
      useTabStore.getState().requestWorkspaceFocus({
        tabType: "conversation-status",
        conversationId,
        reason: "plan",
        reasonKey: planFocusReasonKey,
      })
    }

    if (
      source === "live" &&
      deploymentFocusReasonKey &&
      get().activeConversationId === conversationId
    ) {
      const tabState = useTabStore.getState()
      if (!tabState.isSingletonOpen("deploy") || tabState.isWorkspaceCollapsed) {
        tabState.requestWorkspaceFocus({
          tabType: "deploy",
          conversationId,
          reason: "deployment",
          reasonKey: deploymentFocusReasonKey,
        })
      }
    }

    const previewRequest = deploymentPreviewRequest as { url: string; label?: string } | null
    if (
      source === "live" &&
      previewRequest &&
      get().activeConversationId === conversationId
    ) {
      useTabStore.getState().openTab(
        "preview",
        previewRequest.label ?? "部署预览",
        {
          source: "deploy",
          initialUrl: previewRequest.url,
        }
      )
    }
  },

  failRunStart: (conversationId, message, code) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      const errorMessage = createLocalRunStatusItem(message, code)

      const nextTimelineItems = [...current.timelineItems, errorMessage]

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            runStatus: "failed",
            connectionStatus: "error",
            timelineItems: nextTimelineItems,
          },
        },
      }
    })
  },

  setConnectionStatus: (conversationId, status) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            connectionStatus: status,
          },
        },
      }
    })
  },

  getConversationState: (conversationId) => {
    return getOrCreateState(get().conversations, conversationId)
  },
}))

function appendEventLog(
  events: RuntimeRunEvent[],
  event: RuntimeRunEvent
): RuntimeRunEvent[] {
  if (events.length >= maxEventLogSize) {
    return [...events.slice(events.length - maxEventLogSize + 1), event]
  }
  return [...events, event]
}

type EnvelopeSource = "live" | "replay"

type EnvelopeApplicationResult = {
  activeRuntimeRunId: string | null
  runStatus: RuntimeRunStatus | "idle" | "submitted"
  connectionStatus: RunConnectionStatus
  timelineItems: WorkbenchTimelineItem[]
  deploymentSnapshot: DeploymentSnapshot | null
  receivedEventIds: Set<string>
  events: RuntimeRunEvent[]
  planFocusReasonKey: string | null
  deploymentFocusReasonKey: string | null
  deploymentPreviewRequest: { url: string; label?: string } | null
  changed: boolean
}

function replayTimelineRuns(
  timelineRuns: ConversationTimelineRunSnapshot[],
  messages: PersistedMessage[],
  chatSpeakerIds: Record<string, true>
): Pick<ConversationRuntimeState, "timelineItems" | "deploymentSnapshot" | "receivedEventIds" | "events"> {
  let timelineItems: WorkbenchTimelineItem[] = []
  let deploymentSnapshot: DeploymentSnapshot | null = null
  let receivedEventIds = new Set<string>()
  let events: RuntimeRunEvent[] = []
  const persistedMessagesByRunId = groupPersistedChatMessagesByRun(messages)
  const replayedRunIds = new Set<string>()

  for (const timelineRun of sortTimelineRuns(timelineRuns)) {
    replayedRunIds.add(timelineRun.run.id)
    if (timelineRun.triggerMessage) {
      timelineItems = mergePersistedChatMessages(
        timelineItems,
        [timelineRun.triggerMessage]
      )
    }

    const replayState: ConversationRuntimeState = {
      draft: "",
      timelineItems,
      deploymentSnapshot,
      activeRuntimeRunId: null,
      runStatus: "idle",
      connectionStatus: "idle",
      chatSpeakerIds,
      receivedEventIds,
      events,
    }
    const next = applyEnvelopesToRuntimeState(
      replayState,
      withSyntheticTerminalRunEvent(timelineRun),
      chatSpeakerIds,
      "replay"
    )
    timelineItems = next.timelineItems
    deploymentSnapshot = next.deploymentSnapshot
    receivedEventIds = next.receivedEventIds
    events = next.events
    timelineItems = mergePersistedChatMessages(
      timelineItems,
      persistedMessagesByRunId.get(timelineRun.run.id) ?? []
    )
  }

  const messagesOutsideReplay = sortPersistedChatMessages(messages).filter((message) =>
    !message.runId || !replayedRunIds.has(message.runId)
  )
  timelineItems = mergePersistedChatMessages(timelineItems, messagesOutsideReplay)

  return { timelineItems, deploymentSnapshot, receivedEventIds, events }
}

function replayHistoryPage(
  timelineRuns: ConversationTimelineRunSnapshot[],
  messages: PersistedMessage[],
  chatSpeakerIds: Record<string, true>
): Pick<ConversationRuntimeState, "timelineItems" | "receivedEventIds" | "events"> {
  let timelineItems: WorkbenchTimelineItem[] = []
  let receivedEventIds = new Set<string>()
  let events: RuntimeRunEvent[] = []
  const persistedMessagesByRunId = groupPersistedChatMessagesByRun(messages)
  const replayedRunIds = new Set(timelineRuns.map((timelineRun) => timelineRun.run.id))
  const standaloneMessages = sortPersistedChatMessages(messages).filter((message) =>
    !message.runId || !replayedRunIds.has(message.runId)
  )

  const roots = [
    ...sortTimelineRuns(timelineRuns).map((timelineRun) => ({
      kind: "run" as const,
      createdAt: timelineRun.triggerMessage?.createdAt ?? timelineRun.run.createdAt,
      id: timelineRun.run.id,
      timelineRun,
    })),
    ...standaloneMessages.map((message) => ({
      kind: "message" as const,
      createdAt: message.createdAt,
      id: message.id,
      message,
    })),
  ].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt)
    const rightTime = Date.parse(right.createdAt)
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime
    }
    if (left.kind !== right.kind) {
      return left.kind === "message" ? -1 : 1
    }
    return left.id.localeCompare(right.id)
  })

  for (const root of roots) {
    if (root.kind === "message") {
      timelineItems = mergePersistedChatMessages(timelineItems, [root.message])
      continue
    }

    if (root.timelineRun.triggerMessage) {
      timelineItems = mergePersistedChatMessages(
        timelineItems,
        [root.timelineRun.triggerMessage]
      )
    }

    const replayState: ConversationRuntimeState = {
      draft: "",
      timelineItems,
      deploymentSnapshot,
      activeRuntimeRunId: null,
      runStatus: "idle",
      connectionStatus: "idle",
      chatSpeakerIds,
      receivedEventIds,
      events,
    }
    const next = applyEnvelopesToRuntimeState(
      replayState,
      withSyntheticTerminalRunEvent(root.timelineRun),
      chatSpeakerIds,
      "replay"
    )
    timelineItems = next.timelineItems
    receivedEventIds = next.receivedEventIds
    events = next.events
    timelineItems = mergePersistedChatMessages(
      timelineItems,
      persistedMessagesByRunId.get(root.timelineRun.run.id) ?? []
    )
  }

  return { timelineItems, receivedEventIds, events }
}

function hasUnreplayedCurrentRunEvents(
  current: ConversationRuntimeState,
  replayed: Pick<ConversationRuntimeState, "receivedEventIds">
): boolean {
  const currentRunId = current.activeRuntimeRunId
  if (!currentRunId) return false
  return current.events.some((event) =>
    event.runId === currentRunId && !replayed.receivedEventIds.has(event.id)
  )
}

function prependOlderTimelineItems(
  currentItems: WorkbenchTimelineItem[],
  olderItems: WorkbenchTimelineItem[]
): WorkbenchTimelineItem[] {
  if (olderItems.length === 0) return currentItems

  const dedupedOlderItems = olderItems.filter((olderItem) =>
    !currentItems.some((currentItem) =>
      hasSameTimelineIdentity(currentItem, olderItem)
    )
  )

  if (dedupedOlderItems.length === 0) {
    return currentItems
  }

  return [...dedupedOlderItems, ...currentItems]
}

function hasSameTimelineIdentity(
  left: WorkbenchTimelineItem,
  right: WorkbenchTimelineItem
): boolean {
  if (left.id === right.id) return true

  if (left.kind === "chat_message" && right.kind === "chat_message") {
    if (
      left.runId &&
      right.runId &&
      left.runtimeMessageId &&
      right.runtimeMessageId &&
      left.runId === right.runId &&
      left.runtimeMessageId === right.runtimeMessageId
    ) {
      return true
    }

    if (
      left.persistedMessageId &&
      right.persistedMessageId &&
      left.persistedMessageId === right.persistedMessageId
    ) {
      return true
    }
  }

  return false
}

function withSyntheticTerminalRunEvent(
  timelineRun: ConversationTimelineRunSnapshot
): HubRunEventEnvelope[] {
  const status = timelineRun.run.status
  if (!isTerminalRunStatus(status)) {
    return timelineRun.events
  }

  const terminalType = `run.${status}`
  if (timelineRun.events.some((envelope) => envelope.event.type === terminalType)) {
    return timelineRun.events
  }

  const lastSequence = timelineRun.events.at(-1)?.sequence ?? 0
  return [
    ...timelineRun.events,
    {
      sequence: lastSequence + 1,
      event: {
        id: `local-replay-terminal:${timelineRun.run.id}:${status}`,
        runId: timelineRun.run.id,
        runtimeRunId: timelineRun.run.runtimeId,
        type: terminalType,
        timestamp: new Date().toISOString(),
        data: {
          status,
          reason: "terminal_run_snapshot",
        },
      },
    },
  ]
}

function applyEnvelopesToRuntimeState(
  current: ConversationRuntimeState,
  envelopes: HubRunEventEnvelope[],
  chatSpeakerIds: Record<string, true>,
  source: EnvelopeSource
): EnvelopeApplicationResult {
  let activeRuntimeRunId = current.activeRuntimeRunId
  let runStatus = current.runStatus
  let connectionStatus = current.connectionStatus
  let timelineItems = current.timelineItems
  let deploymentSnapshot = current.deploymentSnapshot
  let eventLog = current.events
  let planFocusReasonKey: string | null = null
  let deploymentFocusReasonKey: string | null = null
  let deploymentPreviewRequest: { url: string; label?: string } | null = null
  let changed = false
  const receivedEventIds = new Set(current.receivedEventIds)

  for (const envelope of sortEnvelopes(envelopes)) {
    const event = envelope.event
    if (receivedEventIds.has(event.id)) {
      continue
    }

    receivedEventIds.add(event.id)
    activeRuntimeRunId = activeRuntimeRunId ?? event.runId
    changed = true

    const nextRunStatus = runStatusByEventType[event.type]
    if (nextRunStatus && nextRunStatus !== runStatus) {
      runStatus = nextRunStatus
      if (isTerminalRunStatus(nextRunStatus)) {
        connectionStatus = "disconnected"
      }
    }

    if (event.type.startsWith("deployment.")) {
      if (source === "live" && !deploymentFocusReasonKey) {
        const data = getRecord(event.data)
        deploymentFocusReasonKey = getString(data?.deploymentId) ?? event.id
      }
      const nextDeploymentSnapshot = reduceDeploymentSnapshot(
        deploymentSnapshot,
        event
      )
      if (nextDeploymentSnapshot !== deploymentSnapshot) {
        deploymentSnapshot = nextDeploymentSnapshot
      }
      if (
        source === "live" &&
        event.type === "deployment.preview.requested"
      ) {
        const data = getRecord(event.data)
        const url = getString(data?.url)
        if (url) {
          deploymentPreviewRequest = {
            url,
            ...(getString(data?.label) ? { label: getString(data?.label) } : {}),
          }
        }
      }
    }

    const shouldProject = timelineEventTypes.has(event.type)
    if (!shouldProject) {
      continue
    }

    eventLog = appendEventLog(eventLog, event)
    const previousPlanSignature = getLatestPlanSignature(timelineItems)
    const nextTimelineItems = applyRuntimeEventToTimeline(
      timelineItems,
      event,
      chatSpeakerIds
    )
    const nextTimelineItemsWithLineage = markRegeneratedAssistantLineage(
      nextTimelineItems,
      event
    )

    if (nextTimelineItemsWithLineage !== timelineItems) {
      const nextPlanSignature = getLatestPlanSignature(nextTimelineItemsWithLineage)
      if (
        source === "live" &&
        nextPlanSignature &&
        nextPlanSignature !== previousPlanSignature
      ) {
        planFocusReasonKey = nextPlanSignature
      }
      timelineItems = nextTimelineItemsWithLineage
    }
  }

  if (source === "replay") {
    deploymentSnapshot = markReplayDeploymentConnectionStale(deploymentSnapshot)
  }

  return {
    activeRuntimeRunId,
    runStatus,
    connectionStatus,
    timelineItems,
    deploymentSnapshot,
    receivedEventIds,
    events: eventLog,
    planFocusReasonKey,
    deploymentFocusReasonKey,
    deploymentPreviewRequest,
    changed,
  }
}

function reduceDeploymentSnapshot(
  current: DeploymentSnapshot | null,
  event: RuntimeRunEvent
): DeploymentSnapshot {
  const data = getRecord(event.data) ?? {}
  const deploymentId = getString(data.deploymentId) ??
    current?.deploymentId ??
    `deployment_${event.runId}`
  const base: DeploymentSnapshot = {
    version: 1,
    deploymentId,
    conversationId: getString(data.conversationId) ?? current?.conversationId,
    status: current?.status ?? "running",
    title: current?.title,
    strategy: current?.strategy,
    server: mergeDeploymentServer(current?.server, data.server),
    connectionId: getString(data.connectionId) ?? current?.connectionId,
    connectionStatus: current?.connectionStatus,
    connectionReason: current?.connectionReason,
    progress: current?.progress,
    commands: current?.commands ?? [],
    logs: current?.logs ?? [],
    releaseNote: current?.releaseNote,
    deploymentUrl: current?.deploymentUrl,
    preview: current?.preview,
    health: current?.health,
    summary: current?.summary,
    updatedAt: event.timestamp,
    completedAt: current?.completedAt,
  }

  switch (event.type) {
    case "deployment.started":
      return {
        ...base,
        status: "running",
        title: getString(data.title) ?? base.title,
        strategy: getString(data.strategy) ?? base.strategy,
      }
    case "deployment.connection.changed":
      return {
        ...base,
        connectionStatus: toDeploymentConnectionStatus(data.connectionStatus) ?? "disconnected",
        connectionReason: getString(data.reason),
      }
    case "deployment.progress.updated":
      return {
        ...base,
        status: base.status ?? "running",
        progress: {
          percent: getNumber(data.percent),
          currentStep: getNumber(data.currentStep),
          totalSteps: getNumber(data.totalSteps),
          stepId: getString(data.stepId),
          stepTitle: getString(data.stepTitle),
          message: getString(data.message) ?? "",
          updatedAt: event.timestamp,
        },
        health: normalizeDeploymentHealth(data.health) ?? base.health,
      }
    case "deployment.command.started":
      return {
        ...base,
        commands: upsertDeploymentCommand(base.commands, {
          commandId: getString(data.commandId),
          command: getString(data.command),
          cwd: getString(data.cwd),
          reason: getString(data.reason),
          status: "running",
          startedAt: getString(data.startedAt) ?? event.timestamp,
        }),
      }
    case "deployment.log.appended":
      return {
        ...base,
        logs: appendDeploymentLog(base.logs, {
          timestamp: event.timestamp,
          commandId: getString(data.commandId),
          stream: toDeploymentLogStream(data.stream),
          text: getString(data.text) ?? "",
          truncated: data.truncated === true,
        }),
      }
    case "deployment.command.completed":
      return {
        ...base,
        commands: upsertDeploymentCommand(base.commands, {
          commandId: getString(data.commandId),
          status: "completed",
          exitCode: getNumber(data.exitCode),
          durationMs: getNumber(data.durationMs),
          completedAt: event.timestamp,
        }),
      }
    case "deployment.command.failed":
      return {
        ...base,
        commands: upsertDeploymentCommand(base.commands, {
          commandId: getString(data.commandId),
          status: "failed",
          exitCode: getNumber(data.exitCode),
          signal: getString(data.signal),
          durationMs: getNumber(data.durationMs),
          error: getRecord(data.error),
          completedAt: event.timestamp,
        }),
      }
    case "deployment.release_note.updated":
      return {
        ...base,
        releaseNote: getString(data.releaseNote) ?? "",
      }
    case "deployment.preview.requested":
      return {
        ...base,
        deploymentUrl: getString(data.url) ?? base.deploymentUrl,
        preview: {
          url: getString(data.url),
          openMode: getString(data.openMode),
          label: getString(data.label),
          requestedAt: event.timestamp,
        },
      }
    case "deployment.completed":
    case "deployment.failed":
    case "deployment.cancelled":
      return {
        ...base,
        status: event.type === "deployment.completed"
          ? "completed"
          : event.type === "deployment.failed"
            ? "failed"
            : "cancelled",
        summary: getString(data.summary) ?? base.summary,
        deploymentUrl: getString(data.deploymentUrl) ?? base.deploymentUrl,
        health: normalizeDeploymentHealth(data.health) ?? base.health,
        completedAt: event.timestamp,
      }
    default:
      return base
  }
}

function mergeDeploymentServer(
  current: DeploymentSnapshot["server"] | undefined,
  value: unknown
): DeploymentSnapshot["server"] | undefined {
  const server = getRecord(value)
  if (!server) return current
  const id = getString(server.id) ?? current?.id
  const displayName = getString(server.displayName) ?? current?.displayName
  if (!id || !displayName) return current
  return {
    id,
    displayName,
    hostLabel: getString(server.hostLabel) ?? current?.hostLabel,
    port: getNumber(server.port) ?? current?.port,
    user: getString(server.user) ?? current?.user,
  }
}

function toDeploymentConnectionStatus(value: unknown): DeploymentConnectionStatus | undefined {
  if (
    value === "connecting" ||
    value === "connected" ||
    value === "disconnecting" ||
    value === "disconnected" ||
    value === "failed" ||
    value === "stale"
  ) {
    return value
  }
  return undefined
}

function upsertDeploymentCommand(
  commands: DeploymentCommandSnapshot[],
  patch: Partial<DeploymentCommandSnapshot> & { commandId?: string }
): DeploymentCommandSnapshot[] {
  if (!patch.commandId) return commands
  const next = [...commands]
  const index = next.findIndex((command) => command.commandId === patch.commandId)
  const command = {
    ...(index >= 0 ? next[index] : { commandId: patch.commandId, status: "running" as const }),
    ...patch,
  } as DeploymentCommandSnapshot
  if (index >= 0) {
    next[index] = command
  } else {
    next.push(command)
  }
  return next
}

function appendDeploymentLog(
  logs: DeploymentLogSnapshot[],
  entry: DeploymentLogSnapshot
): DeploymentLogSnapshot[] {
  return [...logs, entry].slice(-1000)
}

function toDeploymentLogStream(value: unknown): DeploymentLogSnapshot["stream"] {
  return value === "stdout" || value === "stderr" || value === "system"
    ? value
    : "system"
}

function normalizeDeploymentHealth(value: unknown): DeploymentSnapshot["health"] | undefined {
  const health = getRecord(value)
  if (!health) return undefined
  const url = getString(health.url)
  if (!url || typeof health.ok !== "boolean") return undefined
  return {
    url,
    ok: health.ok,
    status: getNumber(health.status),
    durationMs: getNumber(health.durationMs),
    error: getString(health.error),
  }
}

function markReplayDeploymentConnectionStale(
  snapshot: DeploymentSnapshot | null
): DeploymentSnapshot | null {
  if (
    !snapshot ||
    (snapshot.connectionStatus !== "connected" &&
      snapshot.connectionStatus !== "connecting" &&
      snapshot.connectionStatus !== "disconnecting")
  ) {
    return snapshot
  }
  return {
    ...snapshot,
    connectionStatus: "stale",
    connectionReason: snapshot.connectionReason ?? "runtime_replay",
  }
}

function sortTimelineRuns(
  timelineRuns: ConversationTimelineRunSnapshot[]
): ConversationTimelineRunSnapshot[] {
  return [...timelineRuns].sort((left, right) => {
    const leftTime = Date.parse(left.triggerMessage?.createdAt ?? left.run.createdAt)
    const rightTime = Date.parse(right.triggerMessage?.createdAt ?? right.run.createdAt)
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime
    }
    return left.run.id.localeCompare(right.run.id)
  })
}

function sortEnvelopes(envelopes: HubRunEventEnvelope[]): HubRunEventEnvelope[] {
  return envelopes
    .map((envelope, index) => ({ envelope, index }))
    .sort((left, right) => {
      if (left.envelope.sequence !== right.envelope.sequence) {
        return left.envelope.sequence - right.envelope.sequence
      }
      return left.index - right.index
    })
    .map(({ envelope }) => envelope)
}

function getLatestPlanSignature(items: WorkbenchTimelineItem[]): string | null {
  const plan = items.findLast(
    (item): item is WorkbenchTimelinePlanItem => item.kind === "plan"
  )
  if (!plan) return null

  return JSON.stringify({
    id: plan.id,
    runId: plan.runId,
    title: plan.title,
    description: plan.description,
    status: plan.status,
    tasks: plan.tasks.map((task) => ({
      taskId: task.taskId,
      title: task.title,
      targetAgentId: task.targetAgentId,
      status: task.status,
    })),
  })
}

function toTimelineItemFromPersistedMessage(
  message: PersistedMessage
): WorkbenchTimelineItem[] {
  if (message.surface !== "chat") return []
  if (message.role !== "user" && message.role !== "assistant") return []

  const text = message.parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")
  const artifacts = mapPersistedArtifacts(message)
  const toolItems = mapPersistedToolItems(message)
  const attachments = mapPersistedMessageAttachments(message)

  if (
    !text &&
    artifacts.length === 0 &&
    toolItems.length === 0 &&
    attachments.length === 0 &&
    message.role === "assistant" &&
    message.status !== "streaming"
  ) {
    return []
  }

  const runtimeMessageId = getPersistedRuntimeMessageId(message)
  const replyTo = getPersistedReplySnapshot(message)
  const regenerate = getPersistedRegenerateSnapshot(message)
  const item: WorkbenchTimelineChatMessageItem = {
    kind: "chat_message",
    id: getPersistedTimelineMessageId(message, runtimeMessageId),
    persistedMessageId: message.id,
    role: message.role,
    runId: message.runId ?? undefined,
    runtimeMessageId: runtimeMessageId ?? undefined,
    regeneratedFromId: message.regeneratedFromId ?? undefined,
    messageIndex: message.messageIndex ?? undefined,
    agentId: message.agentId ?? undefined,
    text,
    time: formatPersistedMessageTime(message.createdAt),
    status: toTimelineStatus(message.status, message.role),
    ...(replyTo ? { replyTo } : {}),
    ...(regenerate ? { regenerate } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(artifacts.length ? { artifacts } : {}),
    ...(toolItems.length ? { toolItems } : {}),
  }
  const externalModel = getPersistedExternalModel(message)
  return [externalModel ? { ...item, externalModel } : item]
}

function groupPersistedChatMessagesByRun(
  messages: PersistedMessage[]
): Map<string, PersistedMessage[]> {
  const groups = new Map<string, PersistedMessage[]>()
  for (const message of sortPersistedChatMessages(messages)) {
    if (!isPersistedChatMessage(message) || !message.runId) continue
    const current = groups.get(message.runId) ?? []
    current.push(message)
    groups.set(message.runId, current)
  }
  return groups
}

function mergePersistedChatMessages(
  items: WorkbenchTimelineItem[],
  messages: PersistedMessage[]
): WorkbenchTimelineItem[] {
  let nextItems = items

  for (const message of sortPersistedChatMessages(messages)) {
    const [persistedItem] = toTimelineItemFromPersistedMessage(message)
    if (!persistedItem || persistedItem.kind !== "chat_message") continue

    const existingIndex = findMatchingChatMessageIndex(nextItems, persistedItem)
    if (existingIndex < 0) {
      nextItems = [...nextItems, persistedItem]
      continue
    }

    const existing = nextItems[existingIndex]
    if (existing?.kind !== "chat_message") continue
    const merged = mergePersistedChatMessage(existing, persistedItem)
    if (merged !== existing) {
      nextItems = nextItems.map((item, index) =>
        index === existingIndex ? merged : item
      )
    }
  }

  return nextItems
}

function mergePersistedChatMessage(
  current: WorkbenchTimelineChatMessageItem,
  persisted: WorkbenchTimelineChatMessageItem
): WorkbenchTimelineChatMessageItem {
  if (current.role !== persisted.role) return current

  const persistedIsTerminal =
    persisted.status === "completed" ||
    persisted.status === "failed" ||
    persisted.status === "cancelled"
  const shouldUsePersistedText =
    !current.text ||
    (
      persistedIsTerminal &&
      persisted.text.length > current.text.length
    )
  const nextStatus = getMergedTimelineStatus(current.status, persisted.status)
  const next: WorkbenchTimelineChatMessageItem = {
    ...current,
    persistedMessageId: current.persistedMessageId ?? persisted.persistedMessageId,
    runId: current.runId ?? persisted.runId,
    runtimeMessageId: current.runtimeMessageId ?? persisted.runtimeMessageId,
    regeneratedFromId: current.regeneratedFromId ?? persisted.regeneratedFromId,
    messageIndex: current.messageIndex ?? persisted.messageIndex,
    agentId: current.agentId ?? persisted.agentId,
    text: shouldUsePersistedText ? persisted.text : current.text,
    status: nextStatus,
    generation: current.generation ?? persisted.generation,
    externalModel: current.externalModel ?? persisted.externalModel,
    replyTo: current.replyTo ?? persisted.replyTo,
    regenerate: current.regenerate ?? persisted.regenerate,
    attachments: mergeMessageAttachments(current.attachments, persisted.attachments),
    artifacts: mergeArtifacts(current.artifacts, persisted.artifacts),
    toolItems: mergeToolItems(current.toolItems, persisted.toolItems),
  }

  return isSameChatMessage(current, next) ? current : next
}

function findMatchingChatMessageIndex(
  items: WorkbenchTimelineItem[],
  message: WorkbenchTimelineChatMessageItem
): number {
  return items.findIndex((item) => {
    if (item.kind !== "chat_message") return false
    if (item.id === message.id) return true
    return Boolean(
      item.runId &&
      message.runId &&
      item.runtimeMessageId &&
      message.runtimeMessageId &&
      item.runId === message.runId &&
      item.runtimeMessageId === message.runtimeMessageId
    )
  })
}

function isPersistedChatMessage(message: PersistedMessage): boolean {
  return message.surface === "chat" &&
    (message.role === "user" || message.role === "assistant")
}

function getPersistedReplySnapshot(
  message: PersistedMessage
): MessageReplySnapshot | undefined {
  if (!message.parentMessageId) return undefined
  const replyTo = getRecord(message.metadataJson.replyTo)
  if (!replyTo) return undefined

  const messageId = getString(replyTo.messageId)
  const role = getString(replyTo.role)
  const excerpt = getString(replyTo.excerpt)
  if (!messageId || (role !== "user" && role !== "assistant") || !excerpt) {
    return undefined
  }

  return {
    messageId,
    role,
    senderType: getString(replyTo.senderType) ?? role,
    senderId: getNullableString(replyTo.senderId),
    agentId: getNullableString(replyTo.agentId),
    createdAt: getString(replyTo.createdAt) ?? "",
    excerpt,
  }
}

function getPersistedRegenerateSnapshot(
  message: PersistedMessage
): MessageRegenerateSnapshot | undefined {
  const regenerate = getRecord(message.metadataJson.regenerate)
  if (!regenerate) return undefined

  const sourceAssistantMessageId = getString(regenerate.sourceAssistantMessageId)
  const sourceRunId = getString(regenerate.sourceRunId)
  const sourceTriggerMessageId = getString(regenerate.sourceTriggerMessageId)
  const sourceAssistantCreatedAt = getString(regenerate.sourceAssistantCreatedAt)
  const sourceAssistantExcerpt = getString(regenerate.sourceAssistantExcerpt)
  if (
    !sourceAssistantMessageId ||
    !sourceRunId ||
    !sourceTriggerMessageId ||
    !sourceAssistantCreatedAt ||
    !sourceAssistantExcerpt
  ) {
    return undefined
  }

  return {
    sourceAssistantMessageId,
    sourceRunId,
    sourceTriggerMessageId,
    sourceAssistantAgentId: getNullableString(regenerate.sourceAssistantAgentId),
    sourceAssistantCreatedAt,
    sourceAssistantExcerpt,
  }
}

function sortPersistedChatMessages(messages: PersistedMessage[]): PersistedMessage[] {
  return messages.filter(isPersistedChatMessage).sort(comparePersistedMessages)
}

function comparePersistedMessages(
  left: PersistedMessage,
  right: PersistedMessage
): number {
  if (left.runId && right.runId && left.runId === right.runId) {
    const leftSequence = getPersistedMessageOrderSequence(left)
    const rightSequence = getPersistedMessageOrderSequence(right)
    if (leftSequence !== rightSequence) {
      return leftSequence - rightSequence
    }
  }

  const leftTime = Date.parse(left.createdAt)
  const rightTime = Date.parse(right.createdAt)
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime
  }
  return left.id.localeCompare(right.id)
}

function getPersistedMessageOrderSequence(message: PersistedMessage): number {
  if (typeof message.firstEventSequence === "number") {
    return message.firstEventSequence
  }
  if (message.role === "user") {
    return 0
  }
  if (typeof message.messageIndex === "number") {
    return message.messageIndex + 1
  }
  return Number.MAX_SAFE_INTEGER
}

function getPersistedTimelineMessageId(
  message: PersistedMessage,
  runtimeMessageId: string | null
): string {
  if (message.role === "assistant" && message.runId && runtimeMessageId) {
    return `chat:${message.runId}:${runtimeMessageId}`
  }
  return message.id
}

function getPersistedRuntimeMessageId(message: PersistedMessage): string | null {
  return message.runtimeMessageId ?? getString(getPersistedRuntimeMetadata(message).messageId) ?? null
}

function getPersistedRuntimeMetadata(message: PersistedMessage): Record<string, unknown> {
  return getRecord(message.metadataJson.runtime) ?? {}
}

function mapPersistedArtifacts(message: PersistedMessage): Artifact[] {
  return (message.artifacts ?? []).flatMap((artifact) => {
    const type = mapArtifactType(artifact.type)
    if (!type) return []

    const metadata = artifact.metadataJson ?? {}
    const version = artifact.currentVersion ?? undefined
    const diff = getRecord(version?.diffJson)
    const changedFileCount = getNumber(metadata.changedFileCount) ??
      getWorkspaceDiffChangedFileCount(diff)
    const title = type === "diff"
      ? formatArtifactTitle(type)
      : artifact.title || formatArtifactTitle(type)
    return [{
      id: getArtifactDisplayId(artifact, metadata),
      type,
      title,
      description: formatArtifactDescription(artifact, diff, metadata, changedFileCount),
      meta: formatArtifactMeta(artifact, diff, metadata, changedFileCount),
      ...(type === "diff" ? {
        sourceArtifactId: artifact.id,
        conversationId: artifact.conversationId,
        ...(diff ? {
          detail: {
            kind: "workspace-diff" as const,
            workspaceDiff: diff,
            ...(resolvePersistedDiffPatchText(version) ? {
              patchText: resolvePersistedDiffPatchText(version),
            } : {}),
          },
        } : {}),
      } : {}),
    }]
  })
}

function mapPersistedToolItems(message: PersistedMessage): WorkbenchTimelineToolItem[] {
  return message.parts.flatMap((part) => {
    if (part.type !== "tool") return []
    const payload = part.payloadJson ?? {}
    const toolCallId = getPersistedToolCallId(part)
    const toolName =
      getString(payload.providerToolName) ??
      getString(payload.toolName) ??
      getPersistedToolNameFromCallId(toolCallId) ??
      "tool"
    const status = toPersistedToolStatus(part.state)
    const output = status === "output-available"
      ? payload.data ?? payload.result ?? payload.output ?? payload.summary ?? payload
      : undefined

    return [{
      kind: "tool" as const,
      id: `tool:${message.runId ?? message.id}:${toolCallId}`,
      runId: message.runId ?? message.id,
      agentId: message.agentId ?? undefined,
      externalProvider: getString(payload.externalProvider),
      toolCallId,
      toolName,
      title: getString(part.text) ?? getString(payload.summary) ?? toolName,
      time: formatPersistedMessageTime(part.createdAt),
      status,
      input: payload.input ?? payload.parameters,
      output,
      errorText: status === "output-error" ? getPersistedToolErrorText(payload) : undefined,
      order: part.partIndex,
    }]
  })
}

function mapPersistedMessageAttachments(
  message: PersistedMessage
): WorkbenchMessageAttachment[] {
  return message.parts.flatMap((part) => {
    if (part.type !== "image") return []

    const payload = part.payloadJson ?? {}
    if (getString(payload.kind) !== "image") return []

    const assetId = getString(payload.assetId)
    const filename = getString(payload.filename)
    const mediaType = getString(payload.mediaType)
    const size = getNumber(payload.size)
    const url = getString(payload.url)
    if (
      !assetId ||
      !filename ||
      !isPersistedImageMediaType(mediaType) ||
      size === undefined ||
      !isPersistedConversationImageUrl(url)
    ) {
      return []
    }

    const width = getNumber(payload.width)
    const height = getNumber(payload.height)
    return [{
      kind: "image" as const,
      id: part.id || assetId,
      assetId,
      filename,
      mediaType,
      size,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      url,
    }]
  })
}

function isPersistedImageMediaType(value: string | undefined): value is string {
  return value !== undefined && persistedImageMediaTypes.has(value)
}

function isPersistedConversationImageUrl(value: string | undefined): value is string {
  return value !== undefined &&
    value.startsWith("/api/conversations/") &&
    value.includes("/assets/images/") &&
    value.endsWith("/file")
}

function getPersistedToolCallId(part: PersistedMessage["parts"][number]): string {
  const payload = part.payloadJson ?? {}
  return getString(part.entityId) ??
    getString(payload.toolCallId) ??
    getString(payload.providerToolCallId) ??
    (part.partKey.startsWith("tool:") ? part.partKey.slice("tool:".length) : part.partKey) ??
    part.id
}

function getPersistedToolNameFromCallId(toolCallId: string): string | undefined {
  const [provider] = toolCallId.split(":")
  return provider && provider !== toolCallId ? provider : undefined
}

function toPersistedToolStatus(state: string): WorkbenchTimelineToolItem["status"] {
  if (
    state === "input-streaming" ||
    state === "input-available" ||
    state === "approval-requested" ||
    state === "approval-responded" ||
    state === "output-available" ||
    state === "output-error" ||
    state === "output-denied"
  ) {
    return state
  }
  if (state === "done") return "output-available"
  return "input-available"
}

function getPersistedToolErrorText(payload: Record<string, unknown>): string | undefined {
  const error = payload.error
  if (typeof error === "string") return error
  const errorRecord = getRecord(error)
  return getString(errorRecord?.message) ?? getString(errorRecord?.code)
}

function resolvePersistedDiffPatchText(
  version: PersistedArtifact["currentVersion"] | undefined
): string | undefined {
  const patch = getRecord(getRecord(version?.diffJson)?.patch)
  const patchText = getString(patch?.text)
  if (patchText !== undefined) return patchText
  const content = getString(version?.content)
  return content && looksLikeUnifiedDiff(content) ? content : undefined
}

function looksLikeUnifiedDiff(value: string): boolean {
  return /(^|\n)(diff --git |--- |\+\+\+ |@@ )/.test(value)
}

function getArtifactDisplayId(
  artifact: PersistedArtifact,
  metadata: Record<string, unknown>
): string {
  const runtimeEventId = getString(metadata.runtimeEventId)
  if (artifact.type === "diff" && artifact.runId && runtimeEventId) {
    return `diff:${artifact.runId}:${runtimeEventId}`
  }
  return artifact.id
}

function mapArtifactType(type: string): ArtifactKind | undefined {
  if (type === "code" || type === "diff") return type
  if (type === "webpage") return "preview"
  if (type === "deployment") return "deploy"
  return undefined
}

function formatArtifactTitle(type: ArtifactKind): string {
  if (type === "diff") {
    return formatWorkspaceDiffTitle()
  }
  return "产物"
}

function formatArtifactDescription(
  artifact: PersistedArtifact,
  diff: Record<string, unknown> | undefined,
  metadata: Record<string, unknown>,
  changedFileCount: number | undefined
): string {
  if (artifact.type === "diff") {
    return formatWorkspaceDiffDescription(diff, changedFileCount)
  }
  const summary = getString(artifact.currentVersion?.summary) ??
    getString(metadata.summary)
  if (summary) return summary
  return artifact.status
}

function formatArtifactMeta(
  artifact: PersistedArtifact,
  diff: Record<string, unknown> | undefined,
  metadata: Record<string, unknown>,
  changedFileCount: number | undefined
): string {
  if (artifact.type !== "diff") {
    return artifact.status
  }

  const status = getString(metadata.status) ?? getString(diff?.status)
  const baselineDirty = metadata.baselineDirty === true || diff?.baselineDirty === true
  return formatWorkspaceDiffMeta(diff, changedFileCount, {
    baselineDirty,
    status,
  })
}

function getWorkspaceDiffChangedFileCount(
  diff: Record<string, unknown> | undefined
): number | undefined {
  const stats = getRecord(diff?.stats)
  const fromStats = getNumber(stats?.filesChanged)
  if (fromStats !== undefined) return fromStats
  return Array.isArray(diff?.changedFiles) ? diff.changedFiles.length : undefined
}

function mergeArtifacts(
  current: Artifact[] | undefined,
  persisted: Artifact[] | undefined
): Artifact[] | undefined {
  if (!current?.length) return persisted
  if (!persisted?.length) return current

  const byId = new Map(current.map((artifact) => [artifact.id, artifact]))
  for (const artifact of persisted) {
    byId.set(artifact.id, artifact)
  }
  const merged = [...byId.values()]
  if (
    merged.length === current.length &&
    merged.every((artifact, index) => artifact === current[index])
  ) {
    return current
  }
  return merged
}

function mergeMessageAttachments(
  current: WorkbenchMessageAttachment[] | undefined,
  persisted: WorkbenchMessageAttachment[] | undefined
): WorkbenchMessageAttachment[] | undefined {
  if (!current?.length) return persisted
  if (!persisted?.length) return current

  const byAssetId = new Map(current.map((attachment) => [
    attachment.assetId,
    attachment,
  ]))
  for (const attachment of persisted) {
    byAssetId.set(attachment.assetId, attachment)
  }

  const merged = [...byAssetId.values()]
  if (
    merged.length === current.length &&
    merged.every((attachment, index) => attachment === current[index])
  ) {
    return current
  }
  return merged
}

function mergeToolItems(
  current: WorkbenchTimelineToolItem[] | undefined,
  persisted: WorkbenchTimelineToolItem[] | undefined
): WorkbenchTimelineToolItem[] | undefined {
  if (!current?.length) return persisted
  if (!persisted?.length) return current

  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of persisted) {
    const existing = byId.get(item.id)
    byId.set(item.id, existing ? {
      ...existing,
      ...item,
      input: existing.input ?? item.input,
      output: item.output ?? existing.output,
      externalProvider: existing.externalProvider ?? item.externalProvider,
      order: existing.order ?? item.order,
    } : item)
  }

  const merged = [...byId.values()].sort((left, right) =>
    (left.order ?? 0) - (right.order ?? 0)
  )
  if (
    merged.length === current.length &&
    merged.every((item, index) => item === current[index])
  ) {
    return current
  }
  return merged
}

function getPersistedExternalModel(
  message: PersistedMessage
): WorkbenchTimelineChatMessageItem["externalModel"] | undefined {
  const externalModel = getRecord(getPersistedRuntimeMetadata(message).externalModel)
  if (!externalModel) return undefined

  const provider = getString(externalModel.provider)
  const providerId = getString(externalModel.providerId)
  const modelId = getString(externalModel.modelId)
  if (!provider || !providerId || !modelId) {
    return undefined
  }

  const providerName = getString(externalModel.providerName)
  const modelName = getString(externalModel.modelName)
  return {
    provider,
    providerId,
    modelId,
    ...(providerName ? { providerName } : {}),
    ...(modelName ? { modelName } : {}),
  }
}

function toTimelineStatus(
  status: PersistedMessage["status"],
  role: PersistedMessage["role"]
): WorkbenchTimelineStatus | undefined {
  if (status === "streaming" || status === "completed" || status === "failed" || status === "cancelled") {
    return status
  }
  return role === "user" ? "completed" : undefined
}

function getMergedTimelineStatus(
  current: WorkbenchTimelineStatus | undefined,
  persisted: WorkbenchTimelineStatus | undefined
): WorkbenchTimelineStatus | undefined {
  if (!current) return persisted
  if (!persisted) return current
  if (current === "streaming" && persisted !== "streaming") {
    return persisted
  }
  return current
}

function isSameChatMessage(
  left: WorkbenchTimelineChatMessageItem,
  right: WorkbenchTimelineChatMessageItem
): boolean {
  return left.runId === right.runId &&
    left.persistedMessageId === right.persistedMessageId &&
    left.runtimeMessageId === right.runtimeMessageId &&
    left.regeneratedFromId === right.regeneratedFromId &&
    left.messageIndex === right.messageIndex &&
    left.agentId === right.agentId &&
    left.text === right.text &&
    left.status === right.status &&
    left.generation === right.generation &&
    left.externalModel === right.externalModel &&
    left.replyTo === right.replyTo &&
    left.regenerate === right.regenerate &&
    left.attachments === right.attachments &&
    left.toolItems === right.toolItems &&
    left.artifacts === right.artifacts
}

function markRegeneratedAssistantLineage(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent
): WorkbenchTimelineItem[] {
  const sourceAssistantMessageId = findRegenerateSourceAssistantIdForRun(
    items,
    event.runId
  )
  if (!sourceAssistantMessageId) return items

  let changed = false
  const next = items.map((item) => {
    if (item.kind !== "chat_message") return item
    if (item.role !== "assistant") return item
    if (item.runId !== event.runId) return item
    if (event.messageId && item.runtimeMessageId !== event.messageId) return item
    if (event.agentId && item.agentId && item.agentId !== event.agentId) return item
    if (item.regeneratedFromId === sourceAssistantMessageId) return item
    if (item.regeneratedFromId) return item

    changed = true
    return {
      ...item,
      regeneratedFromId: sourceAssistantMessageId,
    }
  })

  return changed ? next : items
}

function findRegenerateSourceAssistantIdForRun(
  items: WorkbenchTimelineItem[],
  runId: string
): string | null {
  const trigger = items.find((item) =>
    item.kind === "chat_message" &&
    item.role === "user" &&
    item.runId === runId &&
    item.regenerate?.sourceAssistantMessageId
  )
  return trigger?.kind === "chat_message"
    ? trigger.regenerate?.sourceAssistantMessageId ?? null
    : null
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined
}

function getNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined
}

function formatPersistedMessageTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}
