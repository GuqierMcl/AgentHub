import { useState, useCallback, useRef } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
import { workbenchQueryKeys } from "./api/query-keys"
import { runStreamManager } from "./runtime/run-stream-manager"
import { useWorkbenchStore } from "./store/workbench-store"
import type {
  ConversationDetail,
  ConversationListItem,
  CreateConversationBody,
} from "./types"

const EMPTY_CONVERSATIONS: ConversationListItem[] = []

export function ChatWorkspace() {
  const queryClient = useQueryClient()
  const activeConversationId = useWorkbenchStore((s) => s.activeConversationId)
  const setActiveConversationId = useWorkbenchStore((s) => s.setActiveConversationId)
  const previousActiveConversationIdRef = useRef<string | null>(null)
  const [newDialogOpen, setNewDialogOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<ConversationListItem | null>(null)
  const [renameTitle, setRenameTitle] = useState("")

  const conversationsQuery = useQuery({
    queryKey: workbenchQueryKeys.conversations.list("active"),
    queryFn: () => conversationsApi.list("active"),
  })

  const conversations = conversationsQuery.data ?? EMPTY_CONVERSATIONS

  const invalidateConversations = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: workbenchQueryKeys.conversations.all,
    })
  }, [queryClient])

  const handleSelectConversation = useCallback((id: string) => {
    if (id === activeConversationId) {
      runStreamManager.disconnect(id)
      setActiveConversationId(null)
      previousActiveConversationIdRef.current = null
      return
    }

    const previousId = previousActiveConversationIdRef.current
    if (previousId && previousId !== id) {
      runStreamManager.disconnect(previousId)
    }

    setActiveConversationId(id)
    previousActiveConversationIdRef.current = id
  }, [activeConversationId, setActiveConversationId])

  const createMutation = useMutation({
    mutationFn: (body: CreateConversationBody) => conversationsApi.create(body),
    onSuccess: async (created) => {
      await invalidateConversations()
      await queryClient.invalidateQueries({
        queryKey: workbenchQueryKeys.conversations.detail(created.id),
      })
    },
  })

  const pinMutation = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      pinned ? conversationsApi.pin(id) : conversationsApi.unpin(id),
    onSuccess: async (_result, variables) => {
      await invalidateConversations()
      await queryClient.invalidateQueries({
        queryKey: workbenchQueryKeys.conversations.detail(variables.id),
      })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      conversationsApi.update(id, { status: archived ? "archived" : "active" }),
    onSuccess: async (_result, variables) => {
      if (activeConversationId === variables.id && variables.archived) {
        runStreamManager.disconnect(variables.id)
        setActiveConversationId(null)
        previousActiveConversationIdRef.current = null
      }
      await invalidateConversations()
      await queryClient.invalidateQueries({
        queryKey: workbenchQueryKeys.conversations.detail(variables.id),
      })
    },
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      conversationsApi.update(id, { title }),
    onSuccess: async (_result, variables) => {
      await invalidateConversations()
      await queryClient.invalidateQueries({
        queryKey: workbenchQueryKeys.conversations.detail(variables.id),
      })
      toast.success("会话已重命名")
      setRenameTarget(null)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "重命名失败")
    },
  })

  const handleCreateConversation = useCallback(
    async (body: CreateConversationBody): Promise<ConversationDetail> => {
      return createMutation.mutateAsync(body)
    },
    [createMutation]
  )

  const handleCreated = useCallback((id: string) => {
    handleSelectConversation(id)
  }, [handleSelectConversation])

  const handlePin = useCallback(async (id: string, pinned: boolean) => {
    try {
      await pinMutation.mutateAsync({ id, pinned })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败")
    }
  }, [pinMutation])

  const handleArchive = useCallback(async (id: string, archived: boolean) => {
    try {
      await archiveMutation.mutateAsync({ id, archived })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败")
    }
  }, [archiveMutation])

  const handleRename = useCallback((id: string) => {
    const conv = conversations.find((c) => c.id === id)
    if (!conv) return
    setRenameTarget(conv)
    setRenameTitle(conv.title)
  }, [conversations])

  const handleRenameSubmit = useCallback(async () => {
    if (!renameTarget || !renameTitle.trim()) return
    await renameMutation.mutateAsync({
      id: renameTarget.id,
      title: renameTitle.trim(),
    })
  }, [renameMutation, renameTarget, renameTitle])

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-cols-[18rem_minmax(0,1fr)] bg-background">
      <ConversationSidebar
        conversations={conversations}
        loading={conversationsQuery.isLoading}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onAdd={() => setNewDialogOpen(true)}
        onPin={handlePin}
        onArchive={handleArchive}
        onRename={handleRename}
      />
      <WorkbenchContentLayout
        activeConversationId={activeConversationId}
        onCreateConversation={() => setNewDialogOpen(true)}
      />
      <NewConversationDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        onCreated={handleCreated}
        onCreateConversation={handleCreateConversation}
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
            <Button
              onClick={handleRenameSubmit}
              disabled={renameMutation.isPending || !renameTitle.trim()}
            >
              {renameMutation.isPending ? "保存中..." : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
