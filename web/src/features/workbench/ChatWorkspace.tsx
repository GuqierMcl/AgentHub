import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { ConversationSidebar } from "./components/ConversationSidebar"
import { NewConversationDialog } from "./components/NewConversationDialog"
import { WorkbenchContentLayout } from "./components/WorkbenchContentLayout"
import { conversationsApi } from "./api/conversations"
import type { ConversationListItem } from "./types"

export function ChatWorkspace() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<ConversationListItem | null>(null)
  const [renameTitle, setRenameTitle] = useState("")
  const [renaming, setRenaming] = useState(false)

  useEffect(() => {
    conversationsApi.list("active").then((data) => {
      setConversations(data)
      if (data.length > 0) {
        setActiveConversationId(data[0].id)
      }
    }).catch(() => {
      // ignore
    }).finally(() => {
      setLoading(false)
    })
  }, [])

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id)
  }, [])

  const handleCreated = useCallback((id: string) => {
    setActiveConversationId(id)
    conversationsApi.list("active").then((data) => {
      setConversations(data)
    }).catch(() => {
      // ignore
    })
  }, [])

  const handlePin = useCallback(async (id: string, pinned: boolean) => {
    try {
      if (pinned) {
        await conversationsApi.pin(id)
      } else {
        await conversationsApi.unpin(id)
      }
      // optimistically update local state
      setConversations((prev) => prev.map((c) =>
        c.id === id ? { ...c, pinnedAt: pinned ? new Date().toISOString() : null } : c
      ))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败")
    }
  }, [])

  const handleArchive = useCallback(async (id: string, archived: boolean) => {
    try {
      await conversationsApi.update(id, { status: archived ? "archived" : "active" })
      setConversations((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败")
    }
  }, [])

  const handleRename = useCallback((id: string) => {
    const conv = conversations.find((c) => c.id === id)
    if (!conv) return
    setRenameTarget(conv)
    setRenameTitle(conv.title)
  }, [conversations])

  const handleRenameSubmit = useCallback(async () => {
    if (!renameTarget || !renameTitle.trim()) return
    setRenaming(true)
    try {
      const result = await conversationsApi.update(renameTarget.id, { title: renameTitle.trim() })
      setConversations((prev) => prev.map((c) =>
        c.id === renameTarget.id ? { ...c, title: result.title } : c
      ))
      toast.success("会话已重命名")
      setRenameTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重命名失败")
    } finally {
      setRenaming(false)
    }
  }, [renameTarget, renameTitle])

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-cols-[18rem_minmax(0,1fr)] bg-background">
      <ConversationSidebar
        conversations={conversations}
        loading={loading}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onAdd={() => setNewDialogOpen(true)}
        onPin={handlePin}
        onArchive={handleArchive}
        onRename={handleRename}
      />
      <WorkbenchContentLayout activeConversationId={activeConversationId} />
      <NewConversationDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        onCreated={handleCreated}
        existingConversations={conversations}
        onSwitchConversation={handleSelectConversation}
      />

      <Dialog open={!!renameTarget} onOpenChange={(open) => { if (!open) setRenameTarget(null) }}>
        <DialogContent from="top" className="w-[400px]">
          <DialogHeader>
            <DialogTitle>重命名</DialogTitle>
          </DialogHeader>
          <Input
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            placeholder="输入新标题"
            onKeyDown={(e) => { if (e.key === "Enter") handleRenameSubmit() }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              取消
            </Button>
            <Button onClick={handleRenameSubmit} disabled={renaming || !renameTitle.trim()}>
              {renaming ? "保存中..." : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
