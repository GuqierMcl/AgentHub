import type { QueryClient } from "@tanstack/react-query"

import type { ConversationMessagesResponse } from "../api/messages"
import { workbenchQueryKeys } from "../api/query-keys"

export function cacheConversationMessagesResult(
  queryClient: QueryClient,
  conversationId: string,
  result: ConversationMessagesResponse
): number {
  const queryKey = workbenchQueryKeys.conversations.messages(conversationId)
  queryClient.setQueryData(queryKey, result)
  return queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? Date.now()
}
