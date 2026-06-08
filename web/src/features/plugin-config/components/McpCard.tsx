import { CheckCircle2Icon, AlertTriangleIcon, TerminalIcon, GlobeIcon, CableIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/animate-ui/components/radix/switch"
import { cn } from "@/lib/utils"
import { getMcpTrustState } from "../plugin-config-state"
import type { McpItem, McpTrustRecord } from "../types"

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

const TRANSPORT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  stdio: TerminalIcon,
  sse: CableIcon,
  http: GlobeIcon,
}

type McpCardProps = {
  mcp: McpItem
  trustRecords?: McpTrustRecord[]
  trustLoading?: boolean
  trustUpdating?: boolean
  onTrustDecision?: (mcpRef: string, trusted: boolean) => void
}

export function McpCard({
  mcp,
  trustRecords = [],
  trustLoading = false,
  trustUpdating = false,
  onTrustDecision,
}: McpCardProps) {
  const TransportIcon = mcp.transport ? TRANSPORT_ICONS[mcp.transport] : null
  const trustState = getMcpTrustState(mcp, trustRecords)
  const canChangeTrust = mcp.valid && mcp.level === "workspace" && !!onTrustDecision

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-sm",
        !mcp.valid && "border-destructive/30"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{mcp.name}</h3>
        </div>
        {mcp.valid ? (
          <CheckCircle2Icon className="size-4 shrink-0 text-emerald-500" />
        ) : (
          <AlertTriangleIcon className="size-4 shrink-0 text-amber-500" />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={cn("text-xs", SOURCE_COLORS[mcp.source] ?? "")}>
          {SOURCE_LABELS[mcp.source] ?? mcp.source}
        </Badge>
        <Badge variant="secondary" className="text-xs">
          {mcp.level === "global" ? "全局" : "工作区"}
        </Badge>
        {mcp.transport && (
          <Badge variant="outline" className="flex items-center gap-1 text-xs">
            {TransportIcon ? <TransportIcon className="size-3" /> : null}
            {mcp.transport.toUpperCase()}
          </Badge>
        )}
        {trustState.kind === "trusted" ? (
          <Badge variant="outline" className="border-emerald-500/30 text-xs text-emerald-600">
            已信任
          </Badge>
        ) : trustState.kind === "untrusted" ? (
          <Badge variant="outline" className="border-amber-500/30 text-xs text-amber-600">
            未信任
          </Badge>
        ) : null}
      </div>

      {mcp.command ? (
        <p className="truncate font-mono text-xs text-muted-foreground">
          <span className="text-muted-foreground/60">cmd: </span>
          {mcp.command}
        </p>
      ) : (
        <p className="text-xs italic text-muted-foreground/60">无命令信息</p>
      )}

      <p className="truncate font-mono text-[11px] text-muted-foreground/70">{mcp.configPath}</p>

      {mcp.level === "workspace" && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">信任</span>
          <Switch
            checked={trustState.kind === "trusted"}
            disabled={!canChangeTrust || trustLoading || trustUpdating}
            onCheckedChange={() => onTrustDecision?.(mcp.id, trustState.kind !== "trusted")}
          />
        </div>
      )}

      {mcp.warnings.length > 0 && (
        <div className="space-y-0.5 rounded-md bg-amber-500/5 px-2.5 py-2">
          {mcp.warnings.map((warning, index) => (
            <p key={index} className="text-xs text-amber-600 dark:text-amber-400">
              {warning}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
