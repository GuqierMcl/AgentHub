import { describe, expect, it } from "bun:test"
import {
  getAggregateServiceStatus,
  getServiceStatusTone,
  getServiceStatusLabel,
} from "./service-status-copy"

describe("service status copy", () => {
  it("uses Chinese status labels for the navigation panel", () => {
    expect(getServiceStatusLabel("running")).toBe("运行中")
    expect(getServiceStatusLabel("starting")).toBe("启动中")
    expect(getServiceStatusLabel("idle")).toBe("就绪")
    expect(getServiceStatusLabel("error")).toBe("错误")
    expect(getServiceStatusLabel("not_integrated")).toBe("未接入")
  })

  it("prioritizes error and starting states in the aggregate indicator", () => {
    expect(getAggregateServiceStatus([
      { id: "agent-runtime", label: "AgentRuntime", kind: "runtime", status: "running", implemented: true, checkedAt: "now" },
      { id: "opencode", label: "OpenCode", kind: "external-agent", status: "starting", implemented: true, checkedAt: "now" },
    ])).toBe("starting")

    expect(getAggregateServiceStatus([
      { id: "agent-runtime", label: "AgentRuntime", kind: "runtime", status: "running", implemented: true, checkedAt: "now" },
      { id: "opencode", label: "OpenCode", kind: "external-agent", status: "error", implemented: true, checkedAt: "now" },
    ])).toBe("error")
  })

  it("maps statuses to stable visual tones", () => {
    expect(getServiceStatusTone("running")).toBe("success")
    expect(getServiceStatusTone("idle")).toBe("success")
    expect(getServiceStatusTone("not_integrated")).toBe("muted")
  })
})
