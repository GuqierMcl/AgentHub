export function formatWorkspaceDiffTitle(): string {
  return "工作区变更"
}

export function formatWorkspaceDiffDescription(
  workspaceDiff: Record<string, unknown> | undefined,
  changedFileCount: number | undefined
): string {
  if (changedFileCount !== undefined && changedFileCount > 0) {
    const stats = getWorkspaceDiffStats(workspaceDiff)
    const statText = formatLineStats(stats.additions, stats.deletions)
    return `${formatChangedFileCount(changedFileCount)}${statText ? `（${statText}）` : ""}`
  }

  const status = getString(workspaceDiff?.status)
  if (status && status !== "available") {
    return formatWorkspaceDiffStatus(status)
  }

  return "工作区 Diff 摘要"
}

export function formatWorkspaceDiffMeta(
  workspaceDiff: Record<string, unknown> | undefined,
  changedFileCount: number | undefined,
  options: {
    baselineDirty?: boolean
    status?: string
  } = {}
): string {
  const stats = getWorkspaceDiffStats(workspaceDiff)
  const patch = getRecord(workspaceDiff?.patch)
  const status = options.status ?? getString(workspaceDiff?.status)
  const baselineDirty = options.baselineDirty ?? workspaceDiff?.baselineDirty === true
  const parts = [
    changedFileCount !== undefined ? formatChangedFileCount(changedFileCount) : undefined,
    ...formatLineStatBadges(stats.additions, stats.deletions),
    baselineDirty ? "运行前已有未提交变更" : undefined,
    status && status !== "available" ? formatWorkspaceDiffStatus(status) : undefined,
    patch?.truncated === true ? "补丁已截断" : undefined,
  ].filter((part): part is string => Boolean(part))

  return parts.length ? parts.join(" | ") : "工作区 Diff"
}

function formatChangedFileCount(count: number): string {
  return `${count} 个文件变更`
}

function formatLineStats(
  additions: number | undefined,
  deletions: number | undefined
): string {
  if (!hasMeaningfulLineStats(additions, deletions)) return ""
  const parts = [
    additions !== undefined ? `+${additions}` : undefined,
    deletions !== undefined ? `-${deletions}` : undefined,
  ].filter(Boolean)
  return parts.join(" / ")
}

function formatLineStatBadges(
  additions: number | undefined,
  deletions: number | undefined
): string[] {
  if (!hasMeaningfulLineStats(additions, deletions)) return []
  return [
    additions !== undefined ? `+${additions}` : undefined,
    deletions !== undefined ? `-${deletions}` : undefined,
  ].filter((part): part is string => Boolean(part))
}

function hasMeaningfulLineStats(
  additions: number | undefined,
  deletions: number | undefined
): boolean {
  return (additions ?? 0) > 0 || (deletions ?? 0) > 0
}

function formatWorkspaceDiffStatus(status: string): string {
  switch (status) {
    case "degraded":
      return "Diff 降级"
    case "unavailable":
      return "Diff 不可用"
    case "failed":
      return "Diff 失败"
    default:
      return status
  }
}

function getWorkspaceDiffStats(
  workspaceDiff: Record<string, unknown> | undefined
): {
  additions?: number
  deletions?: number
} {
  const stats = getRecord(workspaceDiff?.stats)
  return {
    additions: getNumber(stats?.additions),
    deletions: getNumber(stats?.deletions),
  }
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
