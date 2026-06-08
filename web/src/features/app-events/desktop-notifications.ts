import type { HubGlobalEventEnvelope } from "./hub-events-manager"
import {
  isElectrobunRuntime,
  showDesktopNotification,
  type DesktopNotificationOptions,
} from "@/features/app-shell/desktop-runtime"

const MAX_DEDUPE_SIZE = 200

export type DesktopNotificationEnvironment = {
  isDesktopRuntime: () => boolean
  visibilityState: () => DocumentVisibilityState
  hasFocus: () => boolean
  notify: (notification: DesktopNotificationOptions) => Promise<boolean>
}

export type DesktopNotificationDeduper = ((eventId: string) => boolean) & {
  forget?: (eventId: string) => void
}

const desktopNotificationDeduper = createDesktopNotificationDeduper()
const defaultDesktopNotificationEnvironment: DesktopNotificationEnvironment = {
  isDesktopRuntime: isElectrobunRuntime,
  visibilityState: () => document.visibilityState,
  hasFocus: () => document.hasFocus(),
  notify: showDesktopNotification,
}

export function getDesktopNotificationForHubEvent(
  event: HubGlobalEventEnvelope,
): DesktopNotificationOptions | null {
  const status = getNotificationRunStatus(event)

  if (status === "completed") {
    return {
      title: "AgentHub",
      body: "智能体任务已完成。",
    }
  }

  if (status === "failed") {
    return {
      title: "AgentHub",
      body: "智能体任务失败，请回到会话查看详情。",
    }
  }

  if (event.type !== "run.status.changed") {
    return null
  }

  if (event.data.status === "waiting_approval") {
    return {
      title: "AgentHub 需要确认",
      body: "智能体正在等待权限审批。",
    }
  }

  if (event.data.status === "waiting_input") {
    return {
      title: "AgentHub 需要你回答",
      body: "智能体正在等待补充信息。",
    }
  }

  return null
}

function getNotificationRunStatus(
  event: HubGlobalEventEnvelope,
): string | undefined {
  if (event.type === "run.completed") return "completed"
  if (event.type === "run.failed") return "failed"

  if (event.type !== "run.status.changed") {
    return undefined
  }

  return typeof event.data.status === "string" ? event.data.status : undefined
}

export function shouldAttemptDesktopNotification(input: {
  isDesktopRuntime: boolean
  visibilityState: DocumentVisibilityState
  hasFocus: boolean
}): boolean {
  return input.isDesktopRuntime
}

export function createDesktopNotificationDeduper(
  maxSize = MAX_DEDUPE_SIZE,
): DesktopNotificationDeduper {
  const seenEventIds: string[] = []
  const seenEventIdSet = new Set<string>()

  const dedupe = ((eventId: string) => {
    if (seenEventIdSet.has(eventId)) {
      return false
    }

    seenEventIds.push(eventId)
    seenEventIdSet.add(eventId)

    while (seenEventIds.length > maxSize) {
      const oldestEventId = seenEventIds.shift()
      if (oldestEventId) {
        seenEventIdSet.delete(oldestEventId)
      }
    }

    return true
  }) as DesktopNotificationDeduper

  dedupe.forget = (eventId: string) => {
    if (!seenEventIdSet.delete(eventId)) {
      return
    }

    const index = seenEventIds.indexOf(eventId)
    if (index >= 0) {
      seenEventIds.splice(index, 1)
    }
  }

  return dedupe
}

function getDesktopNotificationDedupeKey(event: HubGlobalEventEnvelope): string {
  const status = getNotificationRunStatus(event)
  const runId = typeof event.data.runId === "string" ? event.data.runId : undefined

  if (runId && status) {
    return `run:${runId}:${status}`
  }

  return event.id
}

export async function maybeNotifyDesktop(
  event: HubGlobalEventEnvelope,
  environment = defaultDesktopNotificationEnvironment,
  dedupe = desktopNotificationDeduper,
): Promise<boolean> {
  const notification = getDesktopNotificationForHubEvent(event)
  if (!notification) return false
  const dedupeKey = getDesktopNotificationDedupeKey(event)
  if (
    !shouldAttemptDesktopNotification({
      isDesktopRuntime: environment.isDesktopRuntime(),
      visibilityState: environment.visibilityState(),
      hasFocus: environment.hasFocus(),
    })
  ) {
    return false
  }
  if (!dedupe(dedupeKey)) return false

  try {
    const notified = await environment.notify(notification)
    if (!notified) {
      dedupe.forget?.(dedupeKey)
    }
    return notified
  } catch {
    dedupe.forget?.(dedupeKey)
    return false
  }
}
