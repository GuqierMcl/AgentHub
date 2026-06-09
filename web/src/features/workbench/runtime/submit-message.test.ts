import { describe, expect, it } from "bun:test"

import {
  ConversationMessageRequestError,
  type ConversationSendAckResponse,
} from "../api/messages"
import type { ChatImageAttachment, ChatSubmitInput } from "../types"
import { submitWorkbenchMessage } from "./submit-message"

const imageInput: NonNullable<ChatSubmitInput["images"]>[number] = {
  type: "file",
  mediaType: "image/png",
  filename: "screen.png",
  url: "data:image/png;base64,abc",
}

function emptyResponse(): ConversationSendAckResponse {
  return {
    conversationId: "conv_test",
    triggerMessage: {
      id: "msg_trigger",
      conversationId: "conv_test",
      runId: "run_test",
      runtimeMessageId: null,
      runtimeRunId: null,
      messageIndex: null,
      surface: "chat",
      role: "user",
      senderType: "user",
      senderId: "user",
      agentId: null,
      taskId: null,
      groupId: null,
      parentMessageId: null,
      regeneratedFromId: null,
      status: "completed",
      finishReason: null,
      firstEventSequence: 0,
      lastEventSequence: 0,
      metadataJson: {},
      uiMessageJson: null,
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
      completedAt: "2026-06-09T00:00:00.000Z",
      parts: [],
    },
    activeRun: {
      id: "run_test",
      runtimeId: "runtime_test",
      status: "queued",
      lastEventSequence: 0,
      plan: null,
    },
  }
}

describe("submitWorkbenchMessage", () => {
  it("keeps the draft and rejects when image upload fails", async () => {
    const draftUpdates: Array<[string, string]> = []
    const submittedRuns: string[] = []
    const failures: Array<{ message: string; code?: string }> = []
    let sendCalls = 0

    await expect(submitWorkbenchMessage({
      activeConversationId: "conv_upload_failed",
      input: {
        content: "Describe this.",
        images: [imageInput],
      },
      hasActiveRun: false,
      setDraft: (...args) => draftUpdates.push(args),
      markRunSubmitted: (conversationId) => submittedRuns.push(conversationId),
      failRunStart: (conversationId, message, code) => {
        failures.push({ message: `${conversationId}:${message}`, code })
      },
      notifyActiveRun: () => {},
      notifyError: () => {},
      uploadImage: async () => {
        throw new ConversationMessageRequestError(
          "Unsupported image file type",
          "INVALID_FILE_TYPE"
        )
      },
      sendMessage: async () => {
        sendCalls += 1
        return emptyResponse()
      },
      onSuccess: () => {},
    })).rejects.toThrow("Unsupported image file type")

    expect(draftUpdates).toEqual([])
    expect(submittedRuns).toEqual(["conv_upload_failed"])
    expect(failures).toEqual([{
      message: "conv_upload_failed:Unsupported image file type",
      code: "INVALID_FILE_TYPE",
    }])
    expect(sendCalls).toBe(0)
  })

  it("clears the draft only after upload and send succeed", async () => {
    const draftUpdates: Array<[string, string]> = []
    const uploaded: ChatImageAttachment = {
      kind: "image",
      assetId: "asset_1",
      filename: "screen.png",
      mediaType: "image/png",
      size: 123,
      url: "/api/conversations/conv_success/assets/images/asset_1/file",
    }
    const sendOptions: unknown[] = []
    let successCalls = 0

    await submitWorkbenchMessage({
      activeConversationId: "conv_success",
      input: {
        content: "",
        images: [imageInput],
      },
      hasActiveRun: false,
      setDraft: (...args) => draftUpdates.push(args),
      markRunSubmitted: () => {},
      failRunStart: () => {},
      notifyActiveRun: () => {},
      notifyError: () => {},
      uploadImage: async () => uploaded,
      sendMessage: async (_conversationId, _content, options) => {
        sendOptions.push(options)
        return emptyResponse()
      },
      onSuccess: () => {
        successCalls += 1
      },
    })

    expect(draftUpdates).toEqual([["conv_success", ""]])
    expect(sendOptions).toEqual([{
      attachments: [{ kind: "image", assetId: "asset_1" }],
    }])
    expect(successCalls).toBe(1)
  })
})
