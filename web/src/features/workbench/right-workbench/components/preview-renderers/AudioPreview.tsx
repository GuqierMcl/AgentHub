import { Maximize2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"

type AudioPreviewProps = {
  url: string
  name: string
  mimeType: string
  onFullscreen?: () => void
}

export function AudioPreview({ url, name, mimeType, onFullscreen }: AudioPreviewProps) {
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
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <audio
          controls
          className="w-full max-w-md"
          preload="metadata"
        >
          <source src={url} type={mimeType} />
          {name}
        </audio>
      </div>
    </div>
  )
}
