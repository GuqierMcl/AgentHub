import { InfoIcon } from "lucide-react"
import { McpCard } from "./McpCard"
import type { McpItem, McpTrustRecord } from "../types"

type McpGridProps = {
  mcps: McpItem[]
  loading: boolean
  error: string | null
  notice?: string | null
  onRetry: () => void
  trustRecords?: McpTrustRecord[]
  trustLoading?: boolean
  trustUpdatingMcpRef?: string | null
  onTrustDecision?: (mcpRef: string, trusted: boolean) => void
}

export function McpGrid({
  mcps,
  loading,
  error,
  notice,
  onRetry,
  trustRecords = [],
  trustLoading = false,
  trustUpdatingMcpRef = null,
  onTrustDecision,
}: McpGridProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="space-y-2 text-center">
          <div className="mx-auto size-8 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
          <p className="text-sm text-muted-foreground">正在加载 MCP Server...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <p className="text-sm text-destructive">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-secondary px-3 py-1.5 text-xs font-medium transition-colors hover:bg-secondary/80"
        >
          重试
        </button>
      </div>
    )
  }

  if (notice) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20">
        <InfoIcon className="size-8 text-blue-500/60" />
        <p className="text-sm text-muted-foreground">{notice}</p>
      </div>
    )
  }

  if (mcps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20">
        <div className="rounded-full bg-muted p-4">
          <svg
            className="size-8 text-muted-foreground/40"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
          >
            <path d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
          </svg>
        </div>
        <p className="text-sm text-muted-foreground">暂无发现 MCP Server</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {mcps.map((mcp) => (
        <McpCard
          key={mcp.id}
          mcp={mcp}
          trustRecords={trustRecords}
          trustLoading={trustLoading}
          trustUpdating={trustUpdatingMcpRef === mcp.id}
          onTrustDecision={onTrustDecision}
        />
      ))}
    </div>
  )
}
