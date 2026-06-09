import { describe, expect, it } from "bun:test"
import { QueryClient } from "@tanstack/react-query"

import type { ConversationMessagesResponse } from "../api/messages"
import { workbenchQueryKeys } from "../api/query-keys"
import { cacheConversationMessagesResult } from "./message-result-cache"

function messagesResponse(): ConversationMessagesResponse {
  return {
    activeRun: null,
    latestPlan: null,
    messages: [],
    runItems: [],
    timelineRuns: [],
  }
}

describe("cacheConversationMessagesResult", () => {
  it("returns the query updated timestamp for the cached snapshot", () => {
    const queryClient = new QueryClient()
    const conversationId = "conv_cache_result"
    const result = messagesResponse()

    const dataUpdatedAt = cacheConversationMessagesResult(
      queryClient,
      conversationId,
      result
    )
    const queryState = queryClient.getQueryState(
      workbenchQueryKeys.conversations.messages(conversationId)
    )

    expect(queryClient.getQueryData(
      workbenchQueryKeys.conversations.messages(conversationId)
    )).toBe(result)
    expect(dataUpdatedAt).toBe(queryState?.dataUpdatedAt)
    expect(dataUpdatedAt).toBeGreaterThan(0)
  })
})
