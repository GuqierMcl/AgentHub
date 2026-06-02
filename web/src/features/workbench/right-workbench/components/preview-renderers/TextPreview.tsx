import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertTriangleIcon, Maximize2Icon } from "lucide-react"

type TextPreviewProps = {
  content: string
  language?: string
  truncated?: boolean
  name?: string
  onFullscreen?: () => void
}

export function TextPreview({ content, language, truncated, onFullscreen }: TextPreviewProps) {
  return (
    <div className="flex h-full flex-col">
      {(language || truncated || onFullscreen) && (
        <div className="flex shrink-0 items-center gap-2 border-border border-b px-3 py-1.5">
          {language && <Badge variant="secondary">{language}</Badge>}
          {truncated && (
            <span className="flex items-center gap-1 text-amber-600 text-xs dark:text-amber-400">
              <AlertTriangleIcon className="size-3" />
              文件过大，已截断
            </span>
          )}
          {onFullscreen && (
            <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={onFullscreen} aria-label="全屏预览">
              <Maximize2Icon className="size-3.5" />
            </Button>
          )}
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1 w-full">
        <pre className="p-4 font-mono text-xs leading-5 whitespace-pre-wrap break-all w-full">
          {content}
        </pre>
      </ScrollArea>
    </div>
  )
}
