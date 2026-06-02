import { useState, useEffect, lazy, Suspense } from "react"
import { FileTextIcon } from "lucide-react"

import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { FullscreenPreview } from "./FullscreenPreview"

import { workspaceBrowserApi } from "../api/workspace-browser"
import type { WorkspaceFilePreviewResponse } from "../types"
import { shouldUseMonaco } from "../utils/code-preview"
import { useEditorSettings } from "@/hooks/useEditorSettings"
import { TextPreview } from "./preview-renderers/TextPreview"
import { MarkdownPreview } from "./preview-renderers/MarkdownPreview"
import { ImagePreview } from "./preview-renderers/ImagePreview"
import { PdfPreview } from "./preview-renderers/PdfPreview"
import { WordPreview } from "./preview-renderers/WordPreview"
import { AudioPreview } from "./preview-renderers/AudioPreview"
import { VideoPreview } from "./preview-renderers/VideoPreview"
import { BinaryPreview } from "./preview-renderers/BinaryPreview"
import { UnsupportedPreview } from "./preview-renderers/UnsupportedPreview"

const CodePreview = lazy(() => import("./preview-renderers/CodePreview").then((m) => ({ default: m.CodePreview })))

type WorkspacePreviewPaneProps = {
  conversationId: string
  selectedPath: string | null
  refreshTrigger?: number
}

export function WorkspacePreviewPane({ conversationId, selectedPath, refreshTrigger }: WorkspacePreviewPaneProps) {
  const [preview, setPreview] = useState<WorkspaceFilePreviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loading = preview === null && error === null
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    if (!selectedPath) return
    let cancelled = false

    workspaceBrowserApi.getFilePreview(conversationId, selectedPath).then((data) => {
      if (!cancelled) {
        setPreview(data)
      }
    }).catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "加载失败")
      }
    })

    return () => { cancelled = true }
  }, [conversationId, selectedPath, refreshTrigger])

  const containerClass = selectedPath && !loading && !error && preview
    ? "h-full w-full min-h-0 min-w-0"
    : "h-full w-full min-w-0"

  return (
    <div className={containerClass}>
      {!selectedPath ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileTextIcon className="size-5" />
            </EmptyMedia>
            <EmptyTitle>选择文件以预览内容</EmptyTitle>
            <EmptyDescription>在右侧文件树中选择文件</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : loading ? (
        <div className="flex h-full flex-col gap-3 p-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="min-h-0 flex-1 rounded" />
        </div>
      ) : error ? (
        <div className="flex h-full items-center justify-center text-sm text-destructive">
          {error}
        </div>
      ) : preview ? (
        <PreviewRenderer preview={preview} conversationId={conversationId} onFullscreen={() => setIsFullscreen(true)} />
      ) : null}

      <FullscreenPreview
        open={isFullscreen}
        onClose={() => setIsFullscreen(false)}
        name={preview?.name ?? ""}
      >
        {preview && <PreviewRenderer preview={preview} conversationId={conversationId} />}
      </FullscreenPreview>
    </div>
  )
}

type PreviewRendererProps = {
  preview: WorkspaceFilePreviewResponse
  conversationId: string
  onFullscreen?: () => void
}

export function PreviewRenderer({ preview, onFullscreen }: PreviewRendererProps) {
  const editorSettings = useEditorSettings()
  switch (preview.kind) {
    case "text":
      if (preview.language === "Markdown") {
        return <MarkdownPreview content={preview.content} name={preview.name} onFullscreen={onFullscreen} />
      }
      if (shouldUseMonaco({
        path: preview.path,
        size: preview.size,
        truncated: preview.truncated,
        content: preview.content,
        maxSize: editorSettings.maxPreviewFileSize,
        maxLineCount: editorSettings.maxLineCount,
        maxLineLength: editorSettings.maxLineLength,
      })) {
        return (
          <Suspense fallback={<div className="flex h-full flex-col gap-3 p-4"><Skeleton className="h-5 w-48" /><Skeleton className="min-h-0 flex-1 rounded" /></div>}>
            <CodePreview
              path={preview.path}
              name={preview.name}
              content={preview.content}
              size={preview.size}
              language={preview.language}
              truncated={preview.truncated}
              onFullscreen={onFullscreen}
            />
          </Suspense>
        )
      }
      return (
        <TextPreview
          content={preview.content}
          language={preview.language}
          truncated={preview.truncated}
          name={preview.name}
          onFullscreen={onFullscreen}
        />
      )
    case "image":
      return <ImagePreview src={preview.base64} alt={preview.name} name={preview.name} onFullscreen={onFullscreen} />
    case "pdf":
      return <PdfPreview url={preview.url} name={preview.name} onFullscreen={onFullscreen} />
    case "office-word":
      return <WordPreview url={preview.url} name={preview.name} onFullscreen={onFullscreen} />
    case "audio":
      return <AudioPreview url={preview.url} name={preview.name} mimeType={preview.mimeType} onFullscreen={onFullscreen} />
    case "video":
      return <VideoPreview url={preview.url} name={preview.name} mimeType={preview.mimeType} posterUrl={preview.posterUrl} onFullscreen={onFullscreen} />
    case "binary":
      return <BinaryPreview name={preview.name} size={preview.size} mimeType={preview.mimeType} message={preview.message} onFullscreen={onFullscreen} />
    case "unsupported":
      return <UnsupportedPreview name={preview.name} size={preview.size} mimeType={preview.mimeType} message={preview.message} onFullscreen={onFullscreen} />
    default:
      return null
  }
}
