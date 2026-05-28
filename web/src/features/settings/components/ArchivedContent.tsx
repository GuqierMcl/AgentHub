import { useState, useEffect, useCallback } from "react"
import { ArchiveRestoreIcon, TrashIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/animate-ui/components/animate/tooltip"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/animate-ui/components/radix/alert-dialog"
import { conversationsApi } from "../../workbench/api/conversations"
import type { ConversationListItem } from "../../workbench/types"

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return "刚刚"
  if (diffMins < 60) return `${diffMins}分钟前`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}小时前`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}天前`
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
}

export function ArchivedContent() {
  const [items, setItems] = useState<ConversationListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [confirmDeleteOne, setConfirmDeleteOne] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      conversationsApi.list("archived").then((data) => {
        setItems(data)
        setLoading(false)
      }).catch(() => {
        setLoading(false)
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const handleRestore = useCallback(async (id: string) => {
    try {
      await conversationsApi.update(id, { status: "active" })
      setItems((prev) => prev.filter((c) => c.id !== id))
      toast.success("会话已恢复")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "恢复失败")
    }
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await conversationsApi.delete(id)
      setItems((prev) => prev.filter((c) => c.id !== id))
      toast.success("会话已删除")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    }
  }, [])

  const handleDeleteAll = useCallback(async () => {
    const ids = items.map((c) => c.id)
    try {
      const result = await conversationsApi.deleteBatch(ids)
      setItems([])
      toast.success(`已删除 ${result.deleted} 个会话`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败")
    }
    setConfirmDeleteAll(false)
  }, [items])

  return (
    <>
      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            加载中...
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            暂无已归档会话
          </div>
        ) : (
          <>
            <div className="flex items-center justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDeleteAll(true)}
              >
                <TrashIcon className="size-4 mr-1" />
                全部删除
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((conv) => (
                <TooltipProvider key={conv.id}>
                  <div className="group relative rounded-lg border px-3 py-3 transition-colors hover:bg-accent">
                    <div className="flex items-start gap-3">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-muted shrink-0">
                        <ArchiveRestoreIcon className="size-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-sm font-semibold">{conv.title}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Badge variant="secondary" className="text-[10px]">
                            {conv.mode === "group" ? "群聊" : "单聊"}
                          </Badge>
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground pt-1">
                        {formatTime(conv.createdAt)}
                      </span>
                    </div>
                    <div className="absolute right-2 bottom-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => handleRestore(conv.id)}
                            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                          >
                            <ArchiveRestoreIcon className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>恢复</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteOne(conv.id)}
                            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive transition-colors"
                          >
                            <TrashIcon className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>删除</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </TooltipProvider>
              ))}
            </div>
          </>
        )}
      </div>

      <AlertDialog open={!!confirmDeleteOne} onOpenChange={(open) => { if (!open) setConfirmDeleteOne(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除此会话吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmDeleteOne(null)}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (confirmDeleteOne) handleDelete(confirmDeleteOne); setConfirmDeleteOne(null) }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteAll} onOpenChange={setConfirmDeleteAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除全部</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除所有已归档会话吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmDeleteAll(false)}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteAll}
            >
              全部删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
