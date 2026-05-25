import { useState, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { agentsApi } from "../api/agents"
import type { AgentSummary } from "../types"

type AgentDeleteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: AgentSummary | null
  onDeleted: () => void
}

export function AgentDeleteDialog({ open, onOpenChange, agent, onDeleted }: AgentDeleteDialogProps) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = useCallback(async () => {
    if (!agent) return
    setDeleting(true)
    setError(null)
    try {
      await agentsApi.delete(agent.id)
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeleting(false)
    }
  }, [agent, onDeleted])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent from="top" className="w-[400px]">
        <DialogTitle>确认删除</DialogTitle>
        <DialogDescription className="sr-only">
          确认删除智能体
        </DialogDescription>

        <p className="text-sm text-muted-foreground">
          确定要删除智能体 <span className="font-medium text-foreground">"{agent?.name}"</span> 吗？
          此操作不可撤销。
        </p>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <div className="flex items-center justify-end gap-2 mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "删除中..." : "删除"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
