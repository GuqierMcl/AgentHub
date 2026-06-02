import { Maximize2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"

type ImagePreviewProps = {
  src: string
  alt: string
  name?: string
  onFullscreen?: () => void
}

export function ImagePreview({ src, alt, name, onFullscreen }: ImagePreviewProps) {
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
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
        <img
          src={src}
          alt={alt}
          className="h-auto max-h-full w-auto max-w-full rounded object-contain"
        />
      </div>
    </div>
  )
}
