import { Maximize2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"

type VideoPreviewProps = {
  url: string
  name: string
  mimeType: string
  posterUrl?: string
  onFullscreen?: () => void
}

export function VideoPreview({ url, name, mimeType, posterUrl, onFullscreen }: VideoPreviewProps) {
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
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <video
          controls
          className="max-h-full max-w-full rounded"
          preload="metadata"
          poster={posterUrl}
        >
          <source src={url} type={mimeType} />
          {name}
        </video>
      </div>
    </div>
  )
}
