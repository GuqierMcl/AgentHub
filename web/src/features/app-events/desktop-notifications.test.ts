import { describe, expect, it } from "bun:test"

import type { HubGlobalEventEnvelope, HubGlobalEventType } from "./hub-events-manager"
import {
  createDesktopNotificationDeduper,
  getDesktopNotificationForHubEvent,
  maybeNotifyDesktop,
  shouldAttemptDesktopNotification,
} from "./desktop-notifications"

function hubEvent(
  type: HubGlobalEventType,
  data: Record<string, unknown> = {},
): HubGlobalEventEnvelope {
  return {
    id: `evt_${type}_${String(data.status ?? "none")}`,
    type,
    timestamp: "2026-06-08T00:00:00.000Z",
    data,
  }
}

describe("desktop notification mapping", () => {
  it("maps terminal and action-required run events to desktop notifications", () => {
    expect(
      getDesktopNotificationForHubEvent(hubEvent("run.completed")),
    ).toEqual({
      title: "AgentHub",
      body: "智能体任务已完成。",
    })
    expect(getDesktopNotificationForHubEvent(hubEvent("run.failed"))).toEqual({
      title: "AgentHub",
      body: "智能体任务失败，请回到会话查看详情。",
    })
    expect(
      getDesktopNotificationForHubEvent(
        hubEvent("run.status.changed", { status: "completed" }),
      ),
    ).toEqual({
      title: "AgentHub",
      body: "智能体任务已完成。",
    })
    expect(
      getDesktopNotificationForHubEvent(
        hubEvent("run.status.changed", { status: "failed" }),
      ),
    ).toEqual({
      title: "AgentHub",
      body: "智能体任务失败，请回到会话查看详情。",
    })
    expect(
      getDesktopNotificationForHubEvent(
        hubEvent("run.status.changed", { status: "waiting_approval" }),
      ),
    ).toEqual({
      title: "AgentHub 需要确认",
      body: "智能体正在等待权限审批。",
    })
    expect(
      getDesktopNotificationForHubEvent(
        hubEvent("run.status.changed", { status: "waiting_input" }),
      ),
    ).toEqual({
      title: "AgentHub 需要你回答",
      body: "智能体正在等待补充信息。",
    })
  })

  it("ignores cancelled, ordinary run states, conversation events, and service events", () => {
    expect(getDesktopNotificationForHubEvent(hubEvent("run.cancelled"))).toBeNull()
    expect(
      getDesktopNotificationForHubEvent(
        hubEvent("run.status.changed", { status: "queued" }),
      ),
    ).toBeNull()
    expect(
      getDesktopNotificationForHubEvent(
        hubEvent("run.status.changed", { status: "running" }),
      ),
    ).toBeNull()
    expect(
      getDesktopNotificationForHubEvent(hubEvent("conversation.last_message.updated")),
    ).toBeNull()
    expect(getDesktopNotificationForHubEvent(hubEvent("service.status.changed"))).toBeNull()
  })
})

describe("desktop notification gating", () => {
  it("suppresses notifications outside desktop runtime only", () => {
    expect(
      shouldAttemptDesktopNotification({
        isDesktopRuntime: false,
        visibilityState: "hidden",
        hasFocus: false,
      }),
    ).toBe(false)
    expect(
      shouldAttemptDesktopNotification({
        isDesktopRuntime: true,
        visibilityState: "visible",
        hasFocus: true,
      }),
    ).toBe(true)
    expect(
      shouldAttemptDesktopNotification({
        isDesktopRuntime: true,
        visibilityState: "hidden",
        hasFocus: true,
      }),
    ).toBe(true)
    expect(
      shouldAttemptDesktopNotification({
        isDesktopRuntime: true,
        visibilityState: "visible",
        hasFocus: false,
      }),
    ).toBe(true)
  })

  it("deduplicates repeated hub event ids", async () => {
    const dedupe = createDesktopNotificationDeduper()
    const notifications: Array<{ title: string; body?: string }> = []
    const event = hubEvent("run.completed")

    const firstResult = await maybeNotifyDesktop(
      event,
      {
        isDesktopRuntime: () => true,
        visibilityState: () => "hidden",
        hasFocus: () => false,
        notify: (notification) => {
          notifications.push(notification)
          return Promise.resolve(true)
        },
      },
      dedupe,
    )
    const secondResult = await maybeNotifyDesktop(
      event,
      {
        isDesktopRuntime: () => true,
        visibilityState: () => "hidden",
        hasFocus: () => false,
        notify: (notification) => {
          notifications.push(notification)
          return Promise.resolve(true)
        },
      },
      dedupe,
    )

    expect(firstResult).toBe(true)
    expect(secondResult).toBe(false)
    expect(notifications).toEqual([
      {
        title: "AgentHub",
        body: "智能体任务已完成。",
      },
    ])
  })

  it("deduplicates equivalent terminal events for the same run", async () => {
    const dedupe = createDesktopNotificationDeduper()
    const notifications: Array<{ title: string; body?: string }> = []
    const environment = {
      isDesktopRuntime: () => true,
      visibilityState: () => "visible" as const,
      hasFocus: () => true,
      notify: (notification: { title: string; body?: string }) => {
        notifications.push(notification)
        return Promise.resolve(true)
      },
    }

    const statusEvent = hubEvent("run.status.changed", {
      runId: "run_internal",
      status: "completed",
    })
    const terminalEvent = hubEvent("run.completed", {
      runId: "run_internal",
      status: "completed",
    })

    expect(await maybeNotifyDesktop(statusEvent, environment, dedupe)).toBe(true)
    expect(await maybeNotifyDesktop(terminalEvent, environment, dedupe)).toBe(false)
    expect(notifications).toEqual([
      {
        title: "AgentHub",
        body: "智能体任务已完成。",
      },
    ])
  })

  it("does not consume terminal dedupe when an earlier notification attempt fails", async () => {
    const dedupe = createDesktopNotificationDeduper()
    const notifications: Array<{ title: string; body?: string }> = []
    const statusEvent = hubEvent("run.status.changed", {
      runId: "run_retry",
      status: "completed",
    })
    const terminalEvent = hubEvent("run.completed", {
      runId: "run_retry",
      status: "completed",
    })

    const failedResult = await maybeNotifyDesktop(
      statusEvent,
      {
        isDesktopRuntime: () => true,
        visibilityState: () => "visible",
        hasFocus: () => true,
        notify: () => Promise.resolve(false),
      },
      dedupe,
    )
    const retryResult = await maybeNotifyDesktop(
      terminalEvent,
      {
        isDesktopRuntime: () => true,
        visibilityState: () => "visible",
        hasFocus: () => true,
        notify: (notification) => {
          notifications.push(notification)
          return Promise.resolve(true)
        },
      },
      dedupe,
    )

    expect(failedResult).toBe(false)
    expect(retryResult).toBe(true)
    expect(notifications).toEqual([
      {
        title: "AgentHub",
        body: "智能体任务已完成。",
      },
    ])
  })
})
