import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  DiffIcon,
  FileSearchIcon,
  FileTextIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { DiffReviewTabPayload } from "@/store/tab-store"

import {
  conversationMessagesApi,
  type DiffArtifactDetail,
  type DiffFileSummary,
} from "../../api/messages"
import {
  parseUnifiedDiff,
  type UnifiedDiffFile,
  type UnifiedDiffLine,
} from "../../utils/unified-diff"

type CodeReviewPanelProps = {
  payload?: DiffReviewTabPayload
}

type ViewerFile = DiffFileSummary & {
  parsed?: UnifiedDiffFile
}

export function CodeReviewPanel({ payload }: CodeReviewPanelProps) {
  const artifactId = payload?.artifactId
  const conversationId = payload?.conversationId
  const shouldFetch = Boolean(artifactId && conversationId)
  const detailQuery = useQuery({
    queryKey: ["artifact-detail", conversationId, artifactId],
    queryFn: () =>
      conversationMessagesApi.artifactDetail(conversationId!, artifactId!),
    enabled: shouldFetch,
  })

  const fallbackDetail = useMemo(
    () => payload?.workspaceDiff
      ? buildDetailFromWorkspaceDiff(payload.workspaceDiff, payload.patchText)
      : undefined,
    [payload?.workspaceDiff, payload?.patchText]
  )
  const detail = detailQuery.data?.diff ?? fallbackDetail
  const files = useMemo(() => buildViewerFiles(detail), [detail])
  const limitationMessages = useMemo(
    () => detail ? formatLimitationMessages(detail.limitations) : [],
    [detail]
  )
  const [selectedPath, setSelectedPath] = useState<string | undefined>()

  useEffect(() => {
    if (!files.length) {
      setSelectedPath(undefined)
      return
    }
    setSelectedPath((current) =>
      current && files.some((file) => file.path === current)
        ? current
        : files[0]?.path
    )
  }, [files])

  if (!payload) {
    return <ReviewEmptyState />
  }

  if (!detail && detailQuery.isLoading) {
    return <ReviewShell title="加载 Diff 详情">正在读取工作区变更...</ReviewShell>
  }

  if (!detail && detailQuery.isError) {
    return (
      <ReviewShell title="Diff 详情不可用">
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive text-xs">
          无法读取该 Diff Artifact，请刷新会话后重试。
        </div>
      </ReviewShell>
    )
  }

  if (!detail) {
    return <ReviewEmptyState />
  }

  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0]
  const stats = getLineStats(detail)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-border border-b p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <DiffIcon className="size-4 shrink-0 text-primary" />
              <h3 className="truncate font-semibold text-sm">工作区变更审查</h3>
            </div>
            <p className="mt-1 truncate text-muted-foreground text-xs">
              {payload.title ?? "Diff Artifact"}
            </p>
          </div>
          <Badge variant="secondary">{files.length} 个文件</Badge>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {stats.additions > 0 ? (
            <Badge className="bg-emerald-500/10 text-emerald-700" variant="secondary">
              +{stats.additions}
            </Badge>
          ) : null}
          {stats.deletions > 0 ? (
            <Badge className="bg-destructive/10 text-destructive" variant="secondary">
              -{stats.deletions}
            </Badge>
          ) : null}
          {detail.baselineDirty ? (
            <Badge variant="outline">运行前已有变更</Badge>
          ) : null}
          {!detail.runOnlyReliable ? (
            <Badge variant="outline">非精确 Run Diff</Badge>
          ) : null}
          {detail.patchTruncated ? (
            <Badge variant="outline">补丁已截断</Badge>
          ) : null}
        </div>

        {limitationMessages.length ? (
          <div className="mt-3 space-y-1">
            {limitationMessages.map((limitation) => (
              <div
                className="flex gap-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-amber-800 text-xs"
                key={limitation}
              >
                <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{limitation}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <FileSearchIcon className="size-4 text-muted-foreground" />
              <h4 className="font-medium text-sm">变更文件</h4>
            </div>
            <div className="space-y-1.5">
              {files.map((file) => (
                <button
                  className={cn(
                    "flex w-full min-w-0 items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                    file.path === selectedFile?.path
                      ? "border-primary/50 bg-primary/5"
                      : "bg-background hover:bg-muted/40"
                  )}
                  key={file.path}
                  onClick={() => setSelectedPath(file.path)}
                  type="button"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-xs">{file.path}</div>
                    {file.oldPath ? (
                      <div className="truncate text-muted-foreground text-[11px]">
                        原路径：{file.oldPath}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {formatFileStats(file)}
                    <Badge variant="secondary">{formatStatus(file.status)}</Badge>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <FileTextIcon className="size-4 text-muted-foreground" />
              <h4 className="font-medium text-sm">文件 Diff</h4>
            </div>
            {selectedFile ? (
              <FilePatchView file={selectedFile} />
            ) : (
              <div className="rounded-md border bg-muted/20 p-3 text-muted-foreground text-xs">
                没有可展示的文件变更。
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}

function ReviewEmptyState() {
  return (
    <ReviewShell title="代码审查">
      <div className="flex h-full min-h-0 items-center justify-center p-6 text-center">
        <div className="max-w-64">
          <FileSearchIcon className="mx-auto size-8 text-muted-foreground" />
          <h3 className="mt-3 font-medium text-sm">选择一个 Diff 卡片</h3>
          <p className="mt-2 text-muted-foreground text-xs">
            从聊天消息中的工作区变更卡片打开，只读查看本次运行写入的文件变化。
          </p>
        </div>
      </div>
    </ReviewShell>
  )
}

function ReviewShell({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-border border-b p-3">
        <div className="flex items-center gap-2">
          <FileSearchIcon className="size-4 text-primary" />
          <h3 className="font-semibold text-sm">{title}</h3>
        </div>
      </div>
      <div className="min-h-0 flex-1 p-3 text-muted-foreground text-xs">
        {children}
      </div>
    </div>
  )
}

function FilePatchView({ file }: { file: ViewerFile }) {
  if (file.binary || file.parsed?.binary) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-muted-foreground text-xs">
        这是二进制文件变更，当前只显示文件级摘要。
      </div>
    )
  }

  if (!file.parsed?.hunks.length) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-muted-foreground text-xs">
        没有可展示的 bounded patch，当前只显示文件级摘要。
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border bg-background">
      {file.parsed.hunks.map((hunk) => (
        <div key={`${file.path}:${hunk.header}`}>
          <div className="border-border border-b bg-muted/50 px-2 py-1 font-mono text-[11px] text-muted-foreground">
            {hunk.header}
          </div>
          <div className="overflow-x-auto">
            {hunk.lines.map((line, index) => (
              <DiffLineRow
                key={`${hunk.header}:${index}:${line.oldLine ?? ""}:${line.newLine ?? ""}`}
                line={line}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function DiffLineRow({ line }: { line: UnifiedDiffLine }) {
  const prefix = line.type === "addition"
    ? "+"
    : line.type === "deletion"
      ? "-"
      : line.type === "context"
        ? " "
        : ""

  return (
    <div
      className={cn(
        "grid min-w-max grid-cols-[3rem_3rem_1fr] font-mono text-[11px] leading-5",
        line.type === "addition" && "bg-emerald-500/10 text-emerald-800",
        line.type === "deletion" && "bg-destructive/10 text-destructive",
        line.type === "meta" && "bg-muted/30 text-muted-foreground"
      )}
    >
      <span className="select-none border-border border-r px-2 text-right text-muted-foreground">
        {line.oldLine ?? ""}
      </span>
      <span className="select-none border-border border-r px-2 text-right text-muted-foreground">
        {line.newLine ?? ""}
      </span>
      <code className="whitespace-pre px-2">
        {prefix}{line.content || " "}
      </code>
    </div>
  )
}

function buildViewerFiles(detail: DiffArtifactDetail | undefined): ViewerFile[] {
  if (!detail) return []
  const parsedFiles = parseUnifiedDiff(detail.patchText)
  const parsedByPath = new Map<string, UnifiedDiffFile>()
  for (const file of parsedFiles) {
    parsedByPath.set(file.path, file)
    if (file.oldPath) parsedByPath.set(file.oldPath, file)
  }

  const files = detail.changedFiles.map((file) => ({
    ...file,
    parsed: parsedByPath.get(file.path) ?? (file.oldPath ? parsedByPath.get(file.oldPath) : undefined),
  }))
  const knownPaths = new Set(files.flatMap((file) => [file.path, file.oldPath].filter(Boolean)))
  for (const parsed of parsedFiles) {
    if (knownPaths.has(parsed.path)) continue
    files.push({
      path: parsed.path,
      ...(parsed.oldPath ? { oldPath: parsed.oldPath } : {}),
      status: parsed.status ?? "changed",
      ...(parsed.binary ? { binary: true } : {}),
      parsed,
    })
  }

  return files
}

function buildDetailFromWorkspaceDiff(
  workspaceDiff: Record<string, unknown>,
  payloadPatchText?: string
): DiffArtifactDetail {
  const patch = getRecord(workspaceDiff.patch)
  const patchText = payloadPatchText ?? getString(patch?.text) ?? ""
  const baselineDirty = workspaceDiff.baselineDirty === true
  const runOnlyReliable = workspaceDiff.runOnlyReliable !== false
  const patchTruncated = patch?.truncated === true
  const limitations = getStringArray(workspaceDiff.limitations)

  if (!patchText) limitations.push("没有可用的 bounded patch，仅展示文件级摘要。")
  if (patchTruncated) limitations.push("补丁内容已按大小预算截断。")
  if (baselineDirty || !runOnlyReliable) {
    limitations.push("运行前已有未提交变更，当前 Diff 不能保证是精确的 run-only patch。")
  }

  return {
    summary: workspaceDiff,
    changedFiles: normalizeChangedFiles(workspaceDiff.changedFiles),
    patchText,
    patchTruncated,
    baselineDirty,
    runOnlyReliable,
    limitations: Array.from(new Set(limitations)),
  }
}

function normalizeChangedFiles(value: unknown): DiffFileSummary[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const file = getRecord(item)
    const path = getString(file?.path) ?? getString(file?.newPath)
    if (!file || !path) return []
    const oldPath = getString(file.oldPath) ?? getString(file.pathBefore)
    return [{
      path,
      ...(oldPath && oldPath !== path ? { oldPath } : {}),
      status: getString(file.status) ?? getString(file.statusAfter) ?? "changed",
      ...(getNumber(file.additions) !== undefined ? { additions: getNumber(file.additions) } : {}),
      ...(getNumber(file.deletions) !== undefined ? { deletions: getNumber(file.deletions) } : {}),
      ...(file.binary === true ? { binary: true } : {}),
      ...(file.truncated === true ? { truncated: true } : {}),
    }]
  })
}

function getLineStats(detail: DiffArtifactDetail): { additions: number; deletions: number } {
  const stats = getRecord(detail.summary.stats)
  const additions = getNumber(stats?.additions)
  const deletions = getNumber(stats?.deletions)
  if (additions !== undefined || deletions !== undefined) {
    return {
      additions: additions ?? 0,
      deletions: deletions ?? 0,
    }
  }

  return detail.changedFiles.reduce(
    (acc, file) => ({
      additions: acc.additions + (file.additions ?? 0),
      deletions: acc.deletions + (file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 }
  )
}

function formatFileStats(file: DiffFileSummary): ReactNode {
  const parts = [
    file.additions && file.additions > 0 ? (
      <span className="text-emerald-700" key="additions">+{file.additions}</span>
    ) : null,
    file.deletions && file.deletions > 0 ? (
      <span className="text-destructive" key="deletions">-{file.deletions}</span>
    ) : null,
  ].filter(Boolean)

  return parts.length ? (
    <span className="flex items-center gap-1 text-[11px]">{parts}</span>
  ) : null
}

function formatStatus(status: string): string {
  const normalized = status.trim().toLowerCase()
  if (normalized === "m" || normalized === "modified") return "修改"
  if (normalized === "a" || normalized === "added" || normalized === "??") return "新增"
  if (normalized === "d" || normalized === "deleted") return "删除"
  if (normalized === "r" || normalized === "renamed") return "重命名"
  if (normalized === "changed") return "变更"
  return status.trim() || "变更"
}

function formatLimitationMessages(limitations: string[]): string[] {
  return Array.from(new Set(limitations.map(formatLimitationMessage)))
}

function formatLimitationMessage(limitation: string): string {
  switch (limitation) {
    case "head_unavailable":
      return "当前 Git 仓库还没有可用的 HEAD（通常是尚未首次提交），Diff 已降级。"
    case "branch_unavailable":
      return "无法读取当前 Git 分支名称。"
    case "numstat_unavailable":
      return "无法通过 Git numstat 获取行数，已尽量使用文件内容估算。"
    case "patch_unavailable":
      return "无法通过 Git 生成 bounded patch，当前只能展示文件级摘要。"
    case "untracked_numstat_unavailable":
      return "未跟踪文件的行数统计不可用。"
    case "untracked_patch_unavailable":
      return "未跟踪文件的补丁内容不可用。"
    case "patch_truncated":
      return "补丁内容已按大小预算截断。"
    case "baseline_dirty_final_diff_is_not_precise_run_only":
      return "运行前已有未提交变更，当前 Diff 不能保证是精确的 run-only patch。"
    case "workspace_not_bound":
      return "本次运行没有绑定工作区。"
    case "git_not_found":
      return "未找到 Git 可执行文件，无法生成完整 Diff。"
    case "git_timeout":
      return "Git Diff 计算超时，结果已降级。"
    case "not_repository":
      return "当前工作区不是 Git 仓库。"
    case "git_failed":
      return "Git Diff 计算失败，结果已降级。"
    case "fingerprint_unavailable":
      return "部分文件指纹不可用，dirty baseline 下的 run-only 判断可能不完整。"
    default:
      return limitation
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

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}
