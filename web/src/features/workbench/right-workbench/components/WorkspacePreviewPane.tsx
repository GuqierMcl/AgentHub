import { useState, useEffect } from "react"
import { FileTextIcon } from "lucide-react"

import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"

import { workspaceBrowserApi } from "../api/workspace-browser"
import type { WorkspaceFilePreviewResponse } from "../types"
import { TextPreview } from "./preview-renderers/TextPreview"
import { MarkdownPreview } from "./preview-renderers/MarkdownPreview"
import { ImagePreview } from "./preview-renderers/ImagePreview"
import { PdfPreview } from "./preview-renderers/PdfPreview"
import { AudioPreview } from "./preview-renderers/AudioPreview"
import { VideoPreview } from "./preview-renderers/VideoPreview"
import { BinaryPreview } from "./preview-renderers/BinaryPreview"
import { UnsupportedPreview } from "./preview-renderers/UnsupportedPreview"

type WorkspacePreviewPaneProps = {
  conversationId: string
  selectedPath: string | null
}

export function WorkspacePreviewPane({ conversationId, selectedPath }: WorkspacePreviewPaneProps) {
  const [preview, setPreview] = useState<WorkspaceFilePreviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loading = preview === null && error === null

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
  }, [conversationId, selectedPath])

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
        <PreviewRenderer preview={preview} conversationId={conversationId} />
      ) : null}
    </div>
  )
}

type PreviewRendererProps = {
  preview: WorkspaceFilePreviewResponse
  conversationId: string
}

function PreviewRenderer({ preview }: PreviewRendererProps) {
  switch (preview.kind) {
    case "text":
      if (preview.language === "Markdown") {
        return <MarkdownPreview content={preview.content} />
      }
      return (
        <TextPreview
          content={preview.content}
          language={preview.language}
          truncated={preview.truncated}
          name={preview.name}
        />
      )
    case "image":
      return <ImagePreview src={preview.base64} alt={preview.name} />
    case "pdf":
      return <PdfPreview url={preview.url} />
    case "audio":
      return <AudioPreview url={preview.url} name={preview.name} mimeType={preview.mimeType} />
    case "video":
      return <VideoPreview url={preview.url} name={preview.name} mimeType={preview.mimeType} posterUrl={preview.posterUrl} />
    case "binary":
      return <BinaryPreview name={preview.name} size={preview.size} mimeType={preview.mimeType} message={preview.message} />
    case "unsupported":
      return <UnsupportedPreview name={preview.name} size={preview.size} mimeType={preview.mimeType} message={preview.message} />
    default:
      return null
  }
}
