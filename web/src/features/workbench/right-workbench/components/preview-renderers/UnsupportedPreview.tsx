import { FileIcon } from "lucide-react"

import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty"

type UnsupportedPreviewProps = {
  name: string
  size: number
  mimeType: string
  message: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function UnsupportedPreview({ name, size, mimeType, message }: UnsupportedPreviewProps) {
  return (
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
  )
}
