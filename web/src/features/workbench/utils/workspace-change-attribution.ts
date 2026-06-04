import type { WorkspaceChangeAttribution } from "../api/messages"

export type WorkspaceAttributionDetailRow = {
  label: string
  value: string
}

export function formatWorkspaceChangeSource(
  attribution: WorkspaceChangeAttribution | undefined,
): string {
  if (!attribution) return "来源：归因未记录"
  return `来源：${formatAttributionKind(attribution)} · ${formatAttributionSubject(attribution)}`
}

export function formatWorkspaceFileAttributionBadge(
  attribution: WorkspaceChangeAttribution | undefined,
): string {
  if (!attribution) return "归因未记录"
  if (attribution.kind === "tool") return attribution.toolName ?? attribution.toolCallId ?? "工具"
  if (attribution.kind === "agent") return formatAgentName(attribution.agentId)
  if (attribution.kind === "task") return attribution.taskId ?? "任务级汇总"
  if (attribution.confidence === "ambiguous") return "归因不确定"
  return attribution.confidence === "unknown" ? "归因未知" : "Run 级汇总"
}

export function formatWorkspaceAttributionDetailRows(
  attribution: WorkspaceChangeAttribution | undefined,
): WorkspaceAttributionDetailRow[] {
  if (!attribution) return []
  return [
    attribution.agentId ? { label: "智能体", value: formatAgentName(attribution.agentId) } : undefined,
    attribution.taskId ? { label: "任务", value: attribution.taskId } : undefined,
    attribution.toolName ? { label: "工具", value: attribution.toolName } : undefined,
    attribution.toolCallId ? { label: "Tool Call", value: attribution.toolCallId } : undefined,
    attribution.messageId ? { label: "消息", value: attribution.messageId } : undefined,
  ].filter((row): row is WorkspaceAttributionDetailRow => Boolean(row))
}

export function formatWorkspaceAttributionCandidateSummary(
  attribution: WorkspaceChangeAttribution | undefined,
): string | undefined {
  if (!attribution) return undefined
  if (attribution.candidateToolCallIds?.length) {
    return `${attribution.candidateToolCallIds.length} 个候选工具，无法精确归因。`
  }
  if (attribution.candidateTaskIds?.length) {
    return `${attribution.candidateTaskIds.length} 个候选任务，无法精确归因。`
  }
  if (attribution.candidateAgentIds?.length) {
    return `${attribution.candidateAgentIds.length} 个候选智能体，无法精确归因。`
  }
  if (attribution.confidence === "unknown") {
    return "缺少足够的消息、任务或工具事实，无法归因。"
  }
  return undefined
}

function formatAttributionKind(attribution: WorkspaceChangeAttribution): string {
  switch (attribution.kind) {
    case "tool":
      return "工具"
    case "task":
      return "任务"
    case "agent":
      return "智能体"
    case "run":
      return "整个 Run"
  }
}

function formatAttributionSubject(attribution: WorkspaceChangeAttribution): string {
  if (attribution.kind === "tool") {
    return attribution.toolName ?? attribution.toolCallId ?? "工具调用"
  }
  if (attribution.kind === "task") {
    return attribution.taskId ?? "任务级汇总"
  }
  if (attribution.kind === "agent") {
    return formatAgentName(attribution.agentId)
  }
  if (attribution.confidence === "ambiguous") {
    return "归因不确定"
  }
  if (attribution.confidence === "unknown") {
    return "归因未知"
  }
  return "Run 级汇总"
}

function formatAgentName(agentId: string | undefined): string {
  switch (agentId) {
    case "opencode":
      return "OpenCode"
    case "codex":
      return "Codex"
    case "claude-code":
      return "Claude Code"
    default:
      return agentId ?? "智能体"
  }
}
