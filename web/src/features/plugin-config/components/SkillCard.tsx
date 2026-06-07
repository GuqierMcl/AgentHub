import { CheckCircle2Icon, AlertTriangleIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { SkillItem } from "../types"

const SOURCE_COLORS: Record<string, string> = {
  agents: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  codex: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  "claude-code": "bg-orange-500/10 text-orange-500 border-orange-500/20",
  opencode: "bg-green-500/10 text-green-500 border-green-500/20",
}

const SOURCE_LABELS: Record<string, string> = {
  agents: "AgentHub",
  codex: "Codex",
  "claude-code": "Claude Code",
  opencode: "OpenCode",
}

type SkillCardProps = {
  skill: SkillItem
}

export function SkillCard({ skill }: SkillCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-sm",
        !skill.valid && "border-destructive/30"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{skill.name}</h3>
        </div>
        {skill.valid ? (
          <CheckCircle2Icon className="size-4 shrink-0 text-emerald-500" />
        ) : (
          <AlertTriangleIcon className="size-4 shrink-0 text-amber-500" />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={cn("text-xs", SOURCE_COLORS[skill.source] ?? "")}>
          {SOURCE_LABELS[skill.source] ?? skill.source}
        </Badge>
        <Badge variant="secondary" className="text-xs">
          {skill.level === "global" ? "全局" : "工作区"}
        </Badge>
      </div>

      {skill.description ? (
        <p className="line-clamp-3 text-xs text-muted-foreground">{skill.description}</p>
      ) : (
        <p className="text-xs italic text-muted-foreground/60">无描述</p>
      )}

      <p className="truncate font-mono text-[11px] text-muted-foreground/70">{skill.path}</p>

      {skill.warnings.length > 0 && (
        <div className="space-y-0.5 rounded-md bg-amber-500/5 px-2.5 py-2">
          {skill.warnings.map((warning, index) => (
            <p key={index} className="text-xs text-amber-600 dark:text-amber-400">
              {warning}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
