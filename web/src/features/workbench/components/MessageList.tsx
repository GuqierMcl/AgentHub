import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"

import type { WorkbenchMessage } from "../types"
import { MessageItem } from "./MessageItem"

type MessageListProps = {
  messages: WorkbenchMessage[]
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="gap-5 p-5">
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}
