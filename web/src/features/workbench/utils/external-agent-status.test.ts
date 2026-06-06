import { describe, expect, it } from "bun:test"

import type { SystemServiceStatusItem } from "@/features/app-shell/api/service-status"
import type { ConversationAgentProfile } from "../types"
import { getExternalAgentStatusBarItems } from "./external-agent-status"

describe("external agent status bar items", () => {
  it("returns current conversation external agents with service status labels", () => {
    const items = getExternalAgentStatusBarItems(
      [
        agent("claude-code", "Claude Code"),
        agent("writer", "Writer"),
        agent("claude-code", "Claude Code Duplicate"),
        agent("opencode", "OpenCode"),
      ],
      [
        service("claude-code", "Claude Code", "running"),
        service("opencode", "OpenCode", "idle"),
        service("codex", "Codex", "not_integrated"),
      ]
    )

    expect(items).toEqual([
      {
        id: "claude-code",
        label: "Claude Code",
        status: "running",
        statusLabel: "运行中",
        tone: "success",
      },
      {
        id: "opencode",
        label: "OpenCode",
        status: "idle",
        statusLabel: "待命",
        tone: "muted",
      },
    ])
  })

  it("ignores disabled external agents", () => {
    const items = getExternalAgentStatusBarItems(
      [agent("claude-code", "Claude Code", false)],
      [service("claude-code", "Claude Code", "running")]
    )

    expect(items).toEqual([])
  })

  it("falls back to not integrated when a conversation service is missing", () => {
    const items = getExternalAgentStatusBarItems(
      [agent("codex", "Codex")],
      []
    )

    expect(items).toEqual([
      {
        id: "codex",
        label: "Codex",
        status: "not_integrated",
        statusLabel: "未接入",
        tone: "muted",
      },
    ])
  })
})

function agent(
  id: string,
  name: string,
  enabled = true
): ConversationAgentProfile {
  return {
    id,
    name,
    role: "primary",
    capabilities: [],
    enabled,
    origin: "external",
    executorType: "external-adapter",
  }
}

function service(
  id: "opencode" | "codex" | "claude-code",
  label: string,
  status: SystemServiceStatusItem["status"]
): SystemServiceStatusItem {
  return {
    id,
    label,
    kind: "external-agent",
    status,
    implemented: status !== "not_integrated",
    checkedAt: "2026-06-06T00:00:00.000Z",
  }
}
