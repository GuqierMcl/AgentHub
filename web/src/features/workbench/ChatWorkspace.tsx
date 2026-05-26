import { useMemo, useState } from "react"

import { conversations } from "./mock-data"
import { ConversationSidebar } from "./components/ConversationSidebar"
import { WorkbenchContentLayout } from "./components/WorkbenchContentLayout"

export function ChatWorkspace() {
  const [activeConversationId, setActiveConversationId] = useState(
    conversations[0].id
  )
  const activeConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.id === activeConversationId
      ) ?? conversations[0],
    [activeConversationId]
  )

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-cols-[18rem_minmax(0,1fr)] bg-background">
      <ConversationSidebar
        activeConversationId={activeConversation.id}
        conversations={conversations}
        onSelectConversation={setActiveConversationId}
      />
      <WorkbenchContentLayout activeConversation={activeConversation} />
    </section>
  )
}

