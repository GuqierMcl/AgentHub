import type { CapabilityScope } from "./types"
import type { SkillItem, WorkspaceSkillTrustRecord } from "./types"

export type SkillTrustState =
  | { kind: "global" }
  | { kind: "trusted"; record: WorkspaceSkillTrustRecord }
  | { kind: "untrusted"; record?: WorkspaceSkillTrustRecord }

export function getCapabilityScopeLabel(scope: CapabilityScope): string {
  switch (scope) {
    case "global":
      return "全局"
    case "workspace":
      return "工作区"
  }
}

export function getMissingWorkspaceNotice(scope: CapabilityScope, conversationId?: string): string | null {
  void scope
  void conversationId
  return null
}

export function isWorkspaceNotice(message: string): boolean {
  return message.includes("no bound workspace") ||
    message.includes("workspace metadata is incomplete") ||
    message.includes("No active conversation has a local workspace root")
}

export function getSkillTrustState(
  skill: SkillItem,
  records: WorkspaceSkillTrustRecord[],
): SkillTrustState {
  if (skill.level !== "workspace") {
    return { kind: "global" }
  }

  const record = records.find((item) => item.skillRef === skill.id)
  if (record?.trusted) {
    return { kind: "trusted", record }
  }
  return { kind: "untrusted", ...(record ? { record } : {}) }
}
