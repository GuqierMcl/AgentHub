import { describe, expect, it } from "bun:test"
import {
  formatExpandedWorkspaceAttributionDetailRows,
  formatWorkspaceAttributionCandidateSummary,
  formatWorkspaceAttributionDetailRows,
  formatWorkspaceChangeSource,
  formatWorkspaceFileAttributionBadge,
} from "./workspace-change-attribution"

describe("workspace change attribution copy", () => {
  it("formats internal tool attribution", () => {
    const attribution = {
      kind: "tool",
      confidence: "inferred",
      agentId: "writer",
      toolCallId: "tool_write_index",
      toolName: "write_file",
      messageId: "msg_writer",
    } as const

    expect(formatWorkspaceChangeSource(attribution)).toBe("来源：工具 · write_file")
    expect(formatWorkspaceFileAttributionBadge(attribution)).toBe("write_file")
    expect(formatWorkspaceAttributionDetailRows(attribution)).toEqual([
      { label: "智能体", value: "writer" },
      { label: "工具", value: "write_file" },
      { label: "Tool Call", value: "tool_write_index" },
      { label: "消息", value: "msg_writer" },
    ])
  })

  it("formats OpenCode aggregate attribution as an agent source", () => {
    const attribution = {
      kind: "agent",
      confidence: "aggregate",
      agentId: "opencode",
    } as const

    expect(formatWorkspaceChangeSource(attribution)).toBe("来源：智能体 · OpenCode")
    expect(formatWorkspaceFileAttributionBadge(attribution)).toBe("OpenCode")
    expect(formatExpandedWorkspaceAttributionDetailRows(attribution)).toEqual([])
  })

  it("formats ambiguous run attribution with candidate count", () => {
    const attribution = {
      kind: "run",
      confidence: "ambiguous",
      candidateToolCallIds: ["tool_a", "tool_b"],
    } as const

    expect(formatWorkspaceChangeSource(attribution)).toBe("来源：整个 Run · 归因不确定")
    expect(formatWorkspaceFileAttributionBadge(attribution)).toBe("归因不确定")
    expect(formatWorkspaceAttributionCandidateSummary(attribution)).toBe("2 个候选工具，无法精确归因。")
  })

  it("keeps only extra details in expanded tool attribution", () => {
    const attribution = {
      kind: "tool",
      confidence: "inferred",
      agentId: "writer",
      toolCallId: "tool_write_index",
      toolName: "write_file",
      messageId: "msg_writer",
    } as const

    expect(formatExpandedWorkspaceAttributionDetailRows(attribution)).toEqual([
      { label: "智能体", value: "writer" },
      { label: "Tool Call", value: "tool_write_index" },
      { label: "消息", value: "msg_writer" },
    ])
  })

  it("handles old diff artifacts without ChangeSet attribution", () => {
    expect(formatWorkspaceChangeSource(undefined)).toBe("来源：归因未记录")
    expect(formatWorkspaceFileAttributionBadge(undefined)).toBe("归因未记录")
    expect(formatWorkspaceAttributionDetailRows(undefined)).toEqual([])
  })
})
