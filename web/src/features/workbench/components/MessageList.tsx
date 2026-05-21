import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"

import type { Artifact, WorkbenchMessage } from "../types"
import { MessageItem } from "./MessageItem"

type MessageListProps = {
  messages: WorkbenchMessage[]
  onOpenArtifact?: (artifact: Artifact) => void
}

export function MessageList({ messages, onOpenArtifact }: MessageListProps) {
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="gap-5 p-5">
        {messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            onOpenArtifact={onOpenArtifact}
          />
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}
