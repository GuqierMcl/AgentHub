import { describe, expect, it } from "bun:test"
import { resolvePtyHostRuntime } from "./terminal-session"

describe("resolvePtyHostRuntime", () => {
  it("uses AGENTHUB_NODE_BIN when provided", () => {
    expect(resolvePtyHostRuntime({
      env: { AGENTHUB_NODE_BIN: "C:\\AgentHub\\node.exe" },
      which: () => "C:\\Program Files\\nodejs\\node.exe",
      fallbackRuntime: "C:\\AgentHub\\bun.exe",
    })).toBe("C:\\AgentHub\\node.exe")
  })

  it("uses the system node binary when no override is provided", () => {
    expect(resolvePtyHostRuntime({
      env: {},
      which: () => "/usr/bin/node",
      fallbackRuntime: "/opt/agenthub/bun",
    })).toBe("/usr/bin/node")
  })

  it("falls back to the current runtime for packaged Bun distributions", () => {
    expect(resolvePtyHostRuntime({
      env: {},
      which: () => null,
      fallbackRuntime: "/opt/agenthub/bun",
    })).toBe("/opt/agenthub/bun")
  })
})
