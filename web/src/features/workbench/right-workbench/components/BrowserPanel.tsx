import { GlobeIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

type BrowserPanelProps = {
  uid: string
  title: string
}

export function BrowserPanel({ uid, title }: BrowserPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-border border-b px-3 py-2">
        <div className="truncate font-medium text-sm">{title}</div>
        <div className="truncate text-muted-foreground text-sm">
          {uid}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-border border-b p-2">
        <Button size="sm" type="button" variant="ghost">
          <GlobeIcon />
        </Button>
        <Input
          className="h-7 flex-1"
          defaultValue="https://localhost:4173"
          readOnly
        />
        <Badge variant="secondary">preview</Badge>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex h-full items-center justify-center p-8">
          <div className="text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <GlobeIcon className="size-6" />
            </div>
            <div className="mt-3 font-medium text-sm">网页预览</div>
            <div className="mt-1 text-muted-foreground text-sm">
              iframe / 静态网页预览占位，后续可挂载真实 URL
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
