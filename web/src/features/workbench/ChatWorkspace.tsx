import { useState, useEffect, useCallback, useRef } from "react"

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
  const loadedRef = useRef(false)

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
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

  const refreshConversations = useCallback(() => {
    conversationsApi.list("active").then((data) => {
      setConversations(data)
    }).catch(() => {
      // ignore
    })
  }, [])

  const handleCreated = useCallback((id: string) => {
    setActiveConversationId(id)
    refreshConversations()
  }, [refreshConversations])

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-cols-[18rem_minmax(0,1fr)] bg-background">
      <ConversationSidebar
        conversations={conversations}
        loading={loading}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onAdd={() => setNewDialogOpen(true)}
      />
      <WorkbenchContentLayout activeConversationId={activeConversationId} />
      <NewConversationDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        onCreated={handleCreated}
        existingConversations={conversations}
        onSwitchConversation={handleSelectConversation}
      />
    </section>
  )
}
