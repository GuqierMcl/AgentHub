import { describe, expect, test } from "bun:test"

import {
  getSkillTrustState,
  getCapabilityScopeLabel,
  getMissingWorkspaceNotice,
  isWorkspaceNotice,
} from "./plugin-config-state"
import type { SkillItem, WorkspaceSkillTrustRecord } from "./types"

describe("plugin config state helpers", () => {
  test("labels capability scopes with workspace semantics", () => {
    expect(getCapabilityScopeLabel("global")).toBe("全局")
    expect(getCapabilityScopeLabel("workspace")).toBe("工作区")
  })

  test("allows workspace discovery without selecting a conversation", () => {
    expect(getMissingWorkspaceNotice("global", undefined)).toBeNull()
    expect(getMissingWorkspaceNotice("workspace", undefined)).toBeNull()
    expect(getMissingWorkspaceNotice("workspace", "conv_1")).toBeNull()
  })

  test("recognizes workspace resolution errors as notices", () => {
    expect(isWorkspaceNotice("Conversation has no bound workspace.")).toBe(true)
    expect(isWorkspaceNotice("Conversation workspace metadata is incomplete.")).toBe(true)
    expect(isWorkspaceNotice("No active conversation has a local workspace root.")).toBe(true)
    expect(isWorkspaceNotice("Runtime unavailable")).toBe(false)
  })

  test("maps workspace Skill trust records to UI state", () => {
    const globalSkill: SkillItem = {
      id: "global:agents:review",
      name: "Review",
      source: "agents",
      level: "global",
      path: "global:agents:review",
      valid: true,
      warnings: [],
    }
    const workspaceSkill: SkillItem = {
      ...globalSkill,
      id: "workspace:agents:review",
      level: "workspace",
      path: "workspace:agents:review",
    }
    const trustedRecord: WorkspaceSkillTrustRecord = {
      workspaceId: "workspace_1",
      backendType: "local",
      workspaceRootHash: "hash",
      skillRef: "workspace:agents:review",
      source: "agents",
      trusted: true,
      status: "trusted",
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:00.000Z",
    }

    expect(getSkillTrustState(globalSkill, [])).toEqual({ kind: "global" })
    expect(getSkillTrustState(workspaceSkill, [])).toEqual({ kind: "untrusted" })
    expect(getSkillTrustState(workspaceSkill, [trustedRecord])).toEqual({
      kind: "trusted",
      record: trustedRecord,
    })
  })
})
