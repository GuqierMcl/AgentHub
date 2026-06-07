import { useEffect, useState } from "react"
import { RefreshCwIcon } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { conversationsApi } from "@/features/workbench/api/conversations"
import type { ConversationListItem } from "@/features/workbench/types"
import type { CapabilityScope } from "../types"

type ScopeSelectorProps = {
  scope: CapabilityScope
  onScopeChange: (scope: CapabilityScope, conversationId?: string) => void
  conversationId?: string
  loading: boolean
  cacheHit?: boolean
  refreshable: boolean
  onRefresh: () => void
}

export function ScopeSelector({
  scope,
  onScopeChange,
  conversationId,
  loading,
  cacheHit,
  refreshable,
  onRefresh,
}: ScopeSelectorProps) {
  const [conversations, setConversations] = useState<ConversationListItem[]>([])

  useEffect(() => {
    if (scope !== "global") {
      conversationsApi.list("active").then(setConversations).catch(() => setConversations([]))
    }
  }, [scope])

  const handleGlobalClick = () => {
    onScopeChange("global")
  }

  const handleSessionClick = () => {
    onScopeChange("workspace")
  }

  const handleConversationChange = (value: string) => {
    onScopeChange("workspace", value)
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex items-center rounded-lg bg-muted p-0.5">
        <button
          type="button"
          onClick={handleGlobalClick}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            scope === "global"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          全局
        </button>
        <button
          type="button"
          onClick={handleSessionClick}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            scope !== "global"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          会话
        </button>
      </div>

      {scope !== "global" && (
        <Select
          value={conversationId ?? ""}
          onValueChange={handleConversationChange}
        >
          <SelectTrigger className="h-8 w-[220px] text-xs">
            <SelectValue placeholder="选择会话..." />
          </SelectTrigger>
          <SelectContent>
            {conversations.map((conv) => (
              <SelectItem key={conv.id} value={conv.id} className="text-xs">
                {conv.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="ml-auto flex items-center gap-2">
        {cacheHit !== undefined && (
          <span className={cn(
            "text-xs",
            cacheHit ? "text-emerald-500" : "text-muted-foreground"
          )}>
            {cacheHit ? "缓存命中" : "已刷新"}
          </span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || !refreshable}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
            "bg-secondary text-secondary-foreground hover:bg-secondary/80",
            (loading || !refreshable) && "cursor-not-allowed opacity-50"
          )}
        >
          <RefreshCwIcon className={cn("size-3", loading && "animate-spin")} />
          刷新
        </button>
      </div>
    </div>
  )
}
