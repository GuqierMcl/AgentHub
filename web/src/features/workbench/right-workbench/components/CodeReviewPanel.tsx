import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircle2Icon,
  DiffIcon,
  FileSearchIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useTabStore, type DiffReviewTabPayload } from "@/store/tab-store"

import {
  conversationMessagesApi,
  type ArtifactRevertPreviewResponse,
  type DiffArtifactDetail,
  type DiffFileSummary,
} from "../../api/messages"
import { workbenchQueryKeys } from "../../api/query-keys"
import {
  parseUnifiedDiff,
  type UnifiedDiffFile,
  type UnifiedDiffLine,
} from "../../utils/unified-diff"
import {
  formatExpandedWorkspaceAttributionDetailRows,
  formatWorkspaceAttributionCandidateSummary,
  formatWorkspaceChangeSource,
  formatWorkspaceFileAttributionBadge,
} from "../../utils/workspace-change-attribution"

type CodeReviewPanelProps = {
  payload?: DiffReviewTabPayload
}

type ViewerFile = DiffFileSummary & {
  parsed?: UnifiedDiffFile
}

export function CodeReviewPanel({ payload }: CodeReviewPanelProps) {
  const queryClient = useQueryClient()
  const openTab = useTabStore((s) => s.openTab)
  const artifactId = payload?.artifactId
  const conversationId = payload?.conversationId
  const shouldFetch = Boolean(artifactId && conversationId)
  const detailQuery = useQuery({
    queryKey: ["artifact-detail", conversationId, artifactId],
    queryFn: () =>
      conversationMessagesApi.artifactDetail(conversationId!, artifactId!),
    enabled: shouldFetch,
  })

  const workspaceDiff = payload?.workspaceDiff
  const patchText = payload?.patchText
  const fallbackDetail = useMemo(
    () => workspaceDiff
      ? buildDetailFromWorkspaceDiff(workspaceDiff, patchText)
      : undefined,
    [workspaceDiff, patchText]
  )
  const detail = detailQuery.data?.diff ?? fallbackDetail
  const files = useMemo(() => buildViewerFiles(detail), [detail])
  const limitationMessages = useMemo(
    () => detail ? formatLimitationMessages(detail.limitations) : [],
    [detail]
  )
  const [selectedPath, setSelectedPath] = useState<string | undefined>()
  const [revertPreview, setRevertPreview] = useState<ArtifactRevertPreviewResponse | null>(null)
  const [revertError, setRevertError] = useState<string | null>(null)
  const [isPreviewingRevert, setIsPreviewingRevert] = useState(false)
  const [isApplyingRevert, setIsApplyingRevert] = useState(false)

  /* eslint-disable react-hooks/set-state-in-effect */
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
  /* eslint-enable react-hooks/set-state-in-effect */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setRevertPreview(null)
    setRevertError(null)
  }, [artifactId, conversationId])
  /* eslint-enable react-hooks/set-state-in-effect */

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

  const stats = getLineStats(detail)
  const isRevertRecord = detail.operation?.type === "revert"
  const revertUnavailableReason = getLocalRevertUnavailableReason(detail, {
    hasPersistedArtifact: Boolean(artifactId && conversationId),
    isRevertRecord,
  })

  const handlePreviewRevert = async () => {
    if (!artifactId || !conversationId || revertUnavailableReason) return
    setIsPreviewingRevert(true)
    setRevertError(null)
    try {
      const preview = await conversationMessagesApi.previewArtifactRevert(conversationId, artifactId)
      setRevertPreview(preview)
      if (preview.status === "blocked" || !preview.canApply) {
        toast.warning(formatRevertBlockedReason(preview.blockedReason, "当前工作区状态无法安全撤销。"))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "撤销预览失败"
      setRevertError(message)
      toast.error(message)
    } finally {
      setIsPreviewingRevert(false)
    }
  }

  const handleApplyRevert = async () => {
    if (!artifactId || !conversationId || !revertPreview?.canApply) return
    setIsApplyingRevert(true)
    setRevertError(null)
    try {
      const result = await conversationMessagesApi.applyArtifactRevert(conversationId, artifactId)
      if ((result.status === "applied" || result.status === "already_applied") && result.artifact) {
        queryClient.setQueryData(
          ["artifact-detail", result.artifact.conversationId, result.artifact.id],
          {
            artifact: result.artifact,
            currentVersion: result.currentVersion ?? null,
            ...(result.diff ? { diff: result.diff } : {}),
          }
        )
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: workbenchQueryKeys.conversations.messages(conversationId),
          }),
          queryClient.invalidateQueries({
            queryKey: workbenchQueryKeys.conversations.all,
          }),
          queryClient.invalidateQueries({
            queryKey: ["artifact-detail", conversationId, artifactId],
          }),
        ])
        openTab("review", "代码审查", {
          source: "artifact",
          title: result.artifact.title,
          conversationId: result.artifact.conversationId,
          artifactId: result.artifact.id,
        })
        setRevertPreview(null)
        toast.success(result.message || "已撤销本次工作区变更。")
        return
      }

      const reason = formatRevertBlockedReason(
        result.blockedReason ?? result.error,
        result.message || "撤销操作没有完成。"
      )
      setRevertError(reason)
      toast.warning(reason)
    } catch (error) {
      const message = error instanceof Error ? error.message : "撤销操作失败"
      setRevertError(message)
      toast.error(message)
    } finally {
      setIsApplyingRevert(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-background">
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

        {isRevertRecord ? (
          <Alert className="mt-3 rounded-md px-3 py-2">
            <CheckCircle2Icon />
            <AlertTitle className="text-xs">撤销记录</AlertTitle>
            <AlertDescription className="text-xs">
              这是一次撤销记录，Diff 展示的是被撤销的原始变更。
            </AlertDescription>
          </Alert>
        ) : (
          <RevertControls
            blockedReason={revertUnavailableReason}
            error={revertError}
            isApplying={isApplyingRevert}
            isPreviewing={isPreviewingRevert}
            onApply={handleApplyRevert}
            onCancelPreview={() => setRevertPreview(null)}
            onPreview={handlePreviewRevert}
            preview={revertPreview}
          />
        )}

        <AttributionSummary attribution={detail.changeSet?.attribution} />

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

      <ScrollArea
        className="min-h-0 w-full min-w-0 flex-1"
        viewportClassName="[&>div]:!block"
      >
        <div className="w-full min-w-0 space-y-4 p-3">
          <section className="min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <FileSearchIcon className="size-4 text-muted-foreground" />
              <h4 className="font-medium text-sm">变更文件</h4>
            </div>
            <div className="space-y-1.5">
              {files.map((file) => {
                const isExpanded = file.path === selectedPath
                return (
                  <FileDiffDisclosure
                    file={file}
                    isExpanded={isExpanded}
                    key={file.path}
                    onToggle={() =>
                      setSelectedPath((current) =>
                        current === file.path ? undefined : file.path
                      )
                    }
                  />
                )
              })}
            </div>
            {!files.length ? (
              <div className="rounded-md border bg-muted/20 p-3 text-muted-foreground text-xs">
                没有可展示的文件变更。
              </div>
            ) : null}
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}

function FileDiffDisclosure({
  file,
  isExpanded,
  onToggle,
}: {
  file: ViewerFile
  isExpanded: boolean
  onToggle: () => void
}) {
  const ChevronIcon = isExpanded ? ChevronDownIcon : ChevronRightIcon
  return (
    <div
      className={cn(
        "w-full min-w-0 overflow-hidden rounded-md border bg-background transition-colors",
        isExpanded ? "border-primary/50 bg-primary/5" : "hover:bg-muted/40"
      )}
    >
      <button
        aria-expanded={isExpanded}
        className="flex w-full min-w-0 items-center justify-between gap-2 px-2.5 py-2 text-left"
        onClick={onToggle}
        type="button"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ChevronIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-xs">{file.path}</div>
            {file.oldPath ? (
              <div className="truncate text-muted-foreground text-[11px]">
                原路径：{file.oldPath}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {formatFileStats(file)}
          <Badge variant={file.attribution ? "outline" : "secondary"}>
            {formatWorkspaceFileAttributionBadge(file.attribution)}
          </Badge>
          <Badge variant="secondary">{formatStatus(file.status)}</Badge>
        </div>
      </button>

      {isExpanded ? (
        <div className="space-y-2 border-border border-t bg-background p-2.5">
          <FileAttributionDetails attribution={file.attribution} />
          <FilePatchView file={file} />
        </div>
      ) : null}
    </div>
  )
}

function RevertControls({
  blockedReason,
  error,
  isApplying,
  isPreviewing,
  onApply,
  onCancelPreview,
  onPreview,
  preview,
}: {
  blockedReason?: string
  error: string | null
  isApplying: boolean
  isPreviewing: boolean
  onApply: () => void
  onCancelPreview: () => void
  onPreview: () => void
  preview: ArtifactRevertPreviewResponse | null
}) {
  if (blockedReason) {
    return (
      <Alert className="mt-3 rounded-md px-3 py-2">
        <AlertTriangleIcon />
        <AlertTitle className="text-xs">当前不可撤销</AlertTitle>
        <AlertDescription className="text-xs">{blockedReason}</AlertDescription>
      </Alert>
    )
  }

  const previewBlocked = preview && (preview.status === "blocked" || !preview.canApply)

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border bg-muted/20 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-muted-foreground text-xs">
          可撤销本次 Run 造成的全部工作区变更。
        </div>
        <Button
          disabled={isPreviewing || isApplying}
          onClick={onPreview}
          size="sm"
          type="button"
          variant="outline"
        >
          {isPreviewing ? (
            <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
          ) : (
            <RotateCcwIcon data-icon="inline-start" />
          )}
          撤销本次变更
        </Button>
      </div>

      {preview ? (
        <div className="rounded-md border bg-background p-2 text-xs">
          {previewBlocked ? (
            <div className="flex gap-2 text-amber-800">
              <AlertTriangleIcon className="mt-0.5 shrink-0" />
              <span>
                {formatRevertBlockedReason(preview.blockedReason, "当前工作区状态无法安全撤销。")}
              </span>
            </div>
          ) : (
            <>
              <div className="font-medium">
                将撤销 {preview.files.length} 个文件的变更。
              </div>
              <div className="mt-1 text-muted-foreground">
                撤销会完整反向应用该 Diff；当前不支持只撤销单个文件或单个 hunk。
              </div>
              {preview.warnings.length ? (
                <div className="mt-2 flex flex-col gap-1 text-amber-800">
                  {preview.warnings.map((warning) => (
                    <div className="flex gap-2" key={warning}>
                      <AlertTriangleIcon className="mt-0.5 shrink-0" />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  disabled={isApplying}
                  onClick={onApply}
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  {isApplying ? (
                    <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <RotateCcwIcon data-icon="inline-start" />
                  )}
                  确认撤销
                </Button>
                <Button
                  disabled={isApplying}
                  onClick={onCancelPreview}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  取消
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-destructive text-xs">
          {error}
        </div>
      ) : null}
    </div>
  )
}

function AttributionSummary({
  attribution,
}: {
  attribution: DiffFileSummary["attribution"]
}) {
  const candidateSummary = formatWorkspaceAttributionCandidateSummary(attribution)
  return (
    <div className="mt-3 rounded-md border bg-muted/20 px-2.5 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={attribution ? "secondary" : "outline"}>
          {formatWorkspaceChangeSource(attribution)}
        </Badge>
        {attribution ? (
          <Badge variant="outline">置信度：{formatAttributionConfidence(attribution.confidence)}</Badge>
        ) : null}
      </div>
      {candidateSummary ? (
        <div className="mt-2 flex gap-2 text-muted-foreground">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{candidateSummary}</span>
        </div>
      ) : null}
    </div>
  )
}

function FileAttributionDetails({
  attribution,
}: {
  attribution: DiffFileSummary["attribution"]
}) {
  const rows = formatExpandedWorkspaceAttributionDetailRows(attribution)
  const candidateSummary = formatWorkspaceAttributionCandidateSummary(attribution)

  if (!attribution) {
    return (
      <div className="rounded-sm bg-muted/30 px-2.5 py-2 text-muted-foreground text-xs">
        归因正在同步：系统会在读取已落库的变更来源后展示归因。
      </div>
    )
  }

  if (!rows.length && !candidateSummary) {
    return null
  }

  return (
    <div className="rounded-sm bg-muted/30 px-2.5 py-2 text-xs">
      {rows.length ? (
        <div className="grid gap-1 sm:grid-cols-2">
          {rows.map((row) => (
            <div className="min-w-0" key={`${row.label}:${row.value}`}>
              <span className="text-muted-foreground">{row.label}：</span>
              <span className="break-all font-mono">{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {candidateSummary ? (
        <div className="mt-2 flex gap-2 text-muted-foreground">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{candidateSummary}</span>
        </div>
      ) : null}
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
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-background">
      <div className="shrink-0 border-border border-b p-3">
        <div className="flex items-center gap-2">
          <FileSearchIcon className="size-4 text-primary" />
          <h3 className="font-semibold text-sm">{title}</h3>
        </div>
      </div>
      <div className="min-h-0 w-full min-w-0 flex-1 p-3 text-muted-foreground text-xs">
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
    <div className="w-full min-w-0 overflow-hidden rounded-md border bg-background">
      {file.parsed.hunks.map((hunk) => (
        <div key={`${file.path}:${hunk.header}`}>
          <div className="truncate border-border border-b bg-muted/50 px-2 py-1 font-mono text-[11px] text-muted-foreground">
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

function getLocalRevertUnavailableReason(
  detail: DiffArtifactDetail,
  options: {
    hasPersistedArtifact: boolean
    isRevertRecord: boolean
  }
): string | undefined {
  if (options.isRevertRecord) {
    return "撤销记录不能再次撤销。"
  }
  if (!options.hasPersistedArtifact) {
    return "实时 Diff 需要先完成落库后才能撤销，请刷新会话或稍后再试。"
  }
  if (!detail.patchText) {
    return "没有可用的 bounded patch，当前只能查看摘要，不能安全撤销。"
  }
  if (detail.patchTruncated) {
    return "补丁内容已截断，无法保证完整撤销。"
  }
  if (detail.baselineDirty || !detail.runOnlyReliable) {
    return "运行前已有未提交变更，当前 Diff 不是可靠的 run-only patch，不能安全撤销。"
  }
  if (detail.changedFiles.some((file) => file.binary)) {
    return "本次变更包含二进制文件，当前版本不支持撤销。"
  }
  if (detail.changedFiles.some((file) => file.truncated)) {
    return "部分文件补丁已截断，无法保证完整撤销。"
  }
  return undefined
}

function formatRevertBlockedReason(
  reason: Record<string, unknown> | undefined,
  fallback: string
): string {
  const message = getString(reason?.message)
  const code = getString(reason?.code)
  if (message) return message
  switch (code) {
    case "ARTIFACT_REVERT_ALREADY_APPLIED":
      return "该 Diff 已经撤销过。"
    case "ARTIFACT_REVERT_UNSUPPORTED":
      return "该 Diff 不满足撤销条件。"
    case "ARTIFACT_REVERT_NOT_RELIABLE":
      return "该 Diff 不是可靠的 run-only patch，不能安全撤销。"
    case "ARTIFACT_REVERT_BLOCKED":
      return "当前工作区状态无法通过反向补丁校验。"
    case "WORKSPACE_REVERT_INVALID_INPUT":
      return "撤销请求缺少必要的工作区或补丁信息。"
    case "WORKSPACE_REVERT_APPLY_FAILED":
      return "反向应用补丁失败，工作区未完成撤销。"
    default:
      return fallback
  }
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

function formatAttributionConfidence(confidence: string): string {
  switch (confidence) {
    case "inferred":
      return "推断"
    case "aggregate":
      return "汇总"
    case "ambiguous":
      return "不确定"
    case "unknown":
      return "未知"
    default:
      return confidence
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
