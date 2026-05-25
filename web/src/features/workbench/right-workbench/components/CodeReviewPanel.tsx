import { useState } from "react"
import { CheckCircle2Icon, DiffIcon, ShieldCheckIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"

import { diffPreviewLines, reviewFiles, reviewIssues } from "../mock-data"

function riskLabel(risk: (typeof reviewFiles)[number]["risk"]) {
  if (risk === "high") {
    return "高风险"
  }
  if (risk === "medium") {
    return "中风险"
  }
  return "低风险"
}

export function CodeReviewPanel() {
  const [reviewNote, setReviewNote] = useState(
    "重点检查三栏布局是否保持视口内滚动，以及 Activity 缓存是否保留面板状态。"
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          <section className="rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ShieldCheckIcon className="size-4 text-primary" />
                  <h3 className="truncate font-medium text-sm">代码审查队列</h3>
                </div>
                <p className="mt-1 text-muted-foreground text-xs">
                  静态审查摘要，后续可接入 agent-runtime 生成真实 Review。
                </p>
              </div>
              <Badge variant="secondary">3 files</Badge>
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <DiffIcon className="size-4 text-muted-foreground" />
              <h3 className="font-medium text-sm">变更文件</h3>
            </div>
            <div className="space-y-2">
              {reviewFiles.map((file) => (
                <div
                  className="rounded-lg border bg-background p-3"
                  key={file.path}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-xs">
                        {file.path}
                      </div>
                      <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
                        {file.summary}
                      </p>
                    </div>
                    <Badge
                      variant={file.risk === "high" ? "destructive" : "outline"}
                    >
                      {riskLabel(file.risk)}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className="text-emerald-600">
                      +{file.additions}
                    </span>
                    <span className="text-destructive">-{file.deletions}</span>
                    <Badge variant="secondary">{file.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-sm">审查发现</h3>
            {reviewIssues.map((issue) => (
              <div className="rounded-lg border bg-background p-3" key={issue.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-xs">{issue.title}</div>
                    <div className="mt-1 text-muted-foreground text-xs">
                      {issue.location}
                    </div>
                  </div>
                  <Badge
                    variant={issue.severity === "P2" ? "secondary" : "outline"}
                  >
                    {issue.severity}
                  </Badge>
                </div>
                <p className="mt-2 text-muted-foreground text-xs">
                  {issue.description}
                </p>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-sm">Diff 预览</h3>
            <pre className="overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-6">
              {diffPreviewLines.join("\n")}
            </pre>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-sm">二次编辑备注</h3>
            <Textarea
              className="min-h-24 resize-none text-xs"
              onChange={(event) => setReviewNote(event.currentTarget.value)}
              value={reviewNote}
            />
          </section>
        </div>
      </ScrollArea>

      <div className="flex shrink-0 items-center justify-between gap-2 border-border border-t p-3">
        <Button size="sm" type="button" variant="outline">
          生成修复提示
        </Button>
        <Button size="sm" type="button">
          <CheckCircle2Icon data-icon="inline-start" />
          应用建议
        </Button>
      </div>
    </div>
  )
}
