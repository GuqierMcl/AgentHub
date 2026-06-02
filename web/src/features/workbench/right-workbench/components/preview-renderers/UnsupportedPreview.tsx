import { FileIcon, Maximize2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty"

type UnsupportedPreviewProps = {
  name: string
  size: number
  mimeType: string
  message: string
  onFullscreen?: () => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function UnsupportedPreview({ name, size, mimeType, message, onFullscreen }: UnsupportedPreviewProps) {
  return (
    <div className="flex h-full flex-col">
      {onFullscreen && (
        <div className="flex shrink-0 items-center justify-between border-border border-b px-3 py-1.5">
          <span className="truncate text-xs text-muted-foreground">{name}</span>
          <Button variant="ghost" size="icon-sm" onClick={onFullscreen} aria-label="全屏预览">
            <Maximize2Icon className="size-3.5" />
          </Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileIcon className="size-5" />
            </EmptyMedia>
            <EmptyTitle>{name}</EmptyTitle>
            <EmptyDescription>{message}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>类型: {mimeType}</span>
              <span>大小: {formatSize(size)}</span>
            </div>
          </EmptyContent>
        </Empty>
      </div>
    </div>
  )
}
