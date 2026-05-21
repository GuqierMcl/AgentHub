import { useState } from "react"
import { LayoutPanelTopIcon, RocketIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import type { Artifact } from "../../types"
import { deployLogs, deploymentEvents } from "../mock-data"

type DeployPreviewPanelProps = {
  previewTarget: string
  selectedArtifact: Artifact | null
}

const eventStateClass = {
  done: "bg-emerald-500",
  running: "bg-primary",
  waiting: "bg-muted-foreground/40",
}

export function DeployPreviewPanel({
  previewTarget,
  selectedArtifact,
}: DeployPreviewPanelProps) {
  const [releaseNote, setReleaseNote] = useState(
    "本轮仅展示静态预览和部署入口，不调用后端发布接口。"
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          <section className="overflow-hidden rounded-lg border bg-muted/20">
            <div className="flex items-center justify-between gap-2 border-border border-b px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <LayoutPanelTopIcon className="size-4 text-primary" />
                <div className="min-w-0">
                  <h3 className="truncate font-medium text-sm">部署预览</h3>
                  <p className="truncate text-muted-foreground text-xs">
                    {previewTarget}
                  </p>
                </div>
              </div>
              <Badge variant="secondary">static</Badge>
            </div>
            <div className="p-3">
              <div className="flex aspect-video items-center justify-center rounded-md border bg-background">
                <div className="text-center">
                  <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <RocketIcon className="size-5" />
                  </div>
                  <div className="mt-2 font-medium text-sm">
                    AgentHub Preview
                  </div>
                  <div className="mt-1 text-muted-foreground text-xs">
                    iframe / 静态产物预览占位
                  </div>
                </div>
              </div>
            </div>
          </section>

          {selectedArtifact ? (
            <section className="rounded-lg border bg-background p-3">
              <div className="text-muted-foreground text-xs">当前产物</div>
              <div className="mt-1 truncate font-medium text-sm">
                {selectedArtifact.title}
              </div>
              <p className="mt-1 text-muted-foreground text-xs">
                {selectedArtifact.description}
              </p>
            </section>
          ) : null}

          <section className="space-y-2 rounded-lg border bg-background p-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm">发布进度</h3>
              <Badge variant="outline">67%</Badge>
            </div>
            <Progress value={67} />
            <div className="space-y-3 pt-2">
              {deploymentEvents.map((event) => (
                <div className="flex gap-3" key={event.id}>
                  <span
                    className={cn(
                      "mt-1 size-2.5 shrink-0 rounded-full",
                      eventStateClass[event.state]
                    )}
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-xs">{event.title}</div>
                    <div className="mt-1 text-muted-foreground text-xs">
                      {event.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-sm">部署日志</h3>
            <pre className="overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-6">
              {deployLogs.join("\n")}
            </pre>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-sm">发布说明</h3>
            <Textarea
              className="min-h-20 resize-none text-xs"
              onChange={(event) => setReleaseNote(event.currentTarget.value)}
              value={releaseNote}
            />
          </section>
        </div>
      </ScrollArea>

      <div className="flex shrink-0 items-center justify-between gap-2 border-border border-t p-3">
        <Button size="sm" type="button" variant="outline">
          复制链接
        </Button>
        <Button size="sm" type="button">
          <RocketIcon data-icon="inline-start" />
          一键部署
        </Button>
      </div>
    </div>
  )
}
