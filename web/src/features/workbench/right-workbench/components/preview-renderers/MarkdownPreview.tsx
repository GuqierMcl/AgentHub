import { Maximize2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Streamdown } from "streamdown"
import { cjk } from "@streamdown/cjk"
import { code } from "@streamdown/code"
import { math } from "@streamdown/math"
import { mermaid } from "@streamdown/mermaid"

type MarkdownPreviewProps = {
  content: string
  name?: string
  onFullscreen?: () => void
}

const streamdownPlugins = { cjk, code, math, mermaid }

export function MarkdownPreview({ content, name, onFullscreen }: MarkdownPreviewProps) {
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
      <ScrollArea
        className="min-h-0 flex-1 min-w-0 w-full"
        viewportClassName="min-w-0 overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full [&>div]:!max-w-full"
      >
        <div className="min-w-0 w-full max-w-full p-4">
          <Streamdown
            className="min-w-0 max-w-full text-sm leading-6 [&>*]:max-w-full [&_blockquote]:break-words [&_img]:h-auto [&_img]:max-w-full [&_p]:break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_[data-streamdown='code-block']]:max-w-full [&_[data-streamdown='code-block-body']]:max-w-full [&_[data-streamdown='mermaid']]:max-w-full [&_[data-streamdown='table-wrapper']]:max-w-full"
            plugins={streamdownPlugins}
          >
            {content}
          </Streamdown>
        </div>
      </ScrollArea>
    </div>
  )
}
