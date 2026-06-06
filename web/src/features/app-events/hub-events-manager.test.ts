import { describe, expect, it } from "bun:test"

import {
  createServiceStatusNotice,
  type HubGlobalEventEnvelope,
} from "./hub-events-manager"
import type {
  ServiceStatusValue,
  SystemServiceStatusItem,
} from "@/features/app-shell/api/service-status"

const EVENT: Pick<HubGlobalEventEnvelope, "id" | "timestamp"> = {
  id: "evt_service_1",
  timestamp: "2026-06-06T00:00:00.000Z",
}

describe("service status global event projection", () => {
  it("creates a chat notice when an external service becomes available", () => {
    const notice = createServiceStatusNotice(EVENT, {
      previousStatus: "error",
      service: service("claude-code", "Claude Code", "idle"),
    })

    expect(notice).toMatchObject({
      kind: "service_status_notice",
      id: "service-status:evt_service_1",
      serviceId: "claude-code",
      text: "Claude Code · 已启动",
      status: "started",
    })
  })

  it("does not create a chat notice for external busy/idle transitions", () => {
    const notice = createServiceStatusNotice(EVENT, {
      previousStatus: "idle",
      service: service("claude-code", "Claude Code", "running"),
    })

    expect(notice).toBeNull()
  })

  it("creates outage notices only for external services", () => {
    expect(createServiceStatusNotice(EVENT, {
      previousStatus: "running",
      service: service("opencode", "OpenCode", "error"),
    })).toMatchObject({
      text: "OpenCode · 服务异常",
      status: "error",
    })

    expect(createServiceStatusNotice(EVENT, {
      previousStatus: "running",
      service: {
        id: "agent-runtime",
        label: "AgentRuntime",
        kind: "runtime",
        status: "error",
        implemented: true,
        checkedAt: "2026-06-06T00:00:00.000Z",
      },
    })).toBeNull()
  })
})

function service(
  id: "opencode" | "codex" | "claude-code",
  label: string,
  status: ServiceStatusValue
): SystemServiceStatusItem {
  return {
    id,
    label,
    kind: "external-agent",
    status,
    implemented: id !== "codex",
    checkedAt: "2026-06-06T00:00:00.000Z",
  }
}
