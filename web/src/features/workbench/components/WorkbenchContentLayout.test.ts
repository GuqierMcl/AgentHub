import { describe, expect, it } from "bun:test"

import { createAvailableExternalServiceBaselineNotices } from "../utils/external-service-notices"
import type { SystemServiceStatusItem } from "@/features/app-shell/api/service-status"
import type {
  ConversationAgentProfile,
  WorkbenchTimelineItem,
} from "../types"

describe("external service baseline notices", () => {
  it("creates a startup notice for an available external service in the active conversation", () => {
    const notices = createAvailableExternalServiceBaselineNotices({
      conversationId: "conv_claude",
      agents: [agent("claude-code", "Claude Code")],
      existingItems: [],
      services: [
        service("claude-code", "Claude Code", "running", true),
        service("opencode", "OpenCode", "idle", true),
      ],
      timestamp: "2026-06-06T00:00:00.000Z",
    })

    expect(notices).toEqual([{
      kind: "service_status_notice",
      id: "service-status:baseline:conv_claude:claude-code",
      serviceId: "claude-code",
      serviceLabel: "Claude Code",
      text: "Claude Code · 已启动",
      time: "2026-06-06T00:00:00.000Z",
      status: "started",
    }])
  })

  it("does not duplicate an existing startup notice", () => {
    const existing: WorkbenchTimelineItem[] = [{
      kind: "service_status_notice",
      id: "service-status:baseline:conv_claude:claude-code",
      serviceId: "claude-code",
      serviceLabel: "Claude Code",
      text: "Claude Code · 已启动",
      time: "2026-06-06T00:00:00.000Z",
      status: "started",
    }]

    const notices = createAvailableExternalServiceBaselineNotices({
      conversationId: "conv_claude",
      agents: [agent("claude-code", "Claude Code")],
      existingItems: existing,
      services: [service("claude-code", "Claude Code", "idle", true)],
      timestamp: "2026-06-06T00:00:01.000Z",
    })

    expect(notices).toEqual([])
  })

  it("ignores unavailable services and services that are not in the conversation", () => {
    const notices = createAvailableExternalServiceBaselineNotices({
      conversationId: "conv_claude",
      agents: [agent("claude-code", "Claude Code")],
      existingItems: [],
      services: [
        service("claude-code", "Claude Code", "error", true),
        service("opencode", "OpenCode", "idle", true),
      ],
      timestamp: "2026-06-06T00:00:00.000Z",
    })

    expect(notices).toEqual([])
  })
})

function agent(id: string, name: string): ConversationAgentProfile {
  return {
    id,
    name,
    role: "primary",
    capabilities: [],
    origin: "external",
    executorType: "external-adapter",
  }
}

function service(
  id: "opencode" | "codex" | "claude-code",
  label: string,
  status: SystemServiceStatusItem["status"],
  implemented: boolean
): SystemServiceStatusItem {
  return {
    id,
    label,
    kind: "external-agent",
    status,
    implemented,
    checkedAt: "2026-06-06T00:00:00.000Z",
  }
}
