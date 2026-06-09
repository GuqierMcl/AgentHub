import {
  ConversationMessageRequestError,
  type ConversationMessagesResponse,
  type SendConversationMessageOptions,
} from "../api/messages"
import type {
  ChatImageAttachment,
  ChatImageAttachmentInput,
  ChatSubmitInput,
} from "../types"

type SubmitWorkbenchMessageOptions = {
  activeConversationId: string | null
  input: ChatSubmitInput
  hasActiveRun: boolean
  setDraft: (conversationId: string, draft: string) => void
  markRunSubmitted: (conversationId: string) => void
  failRunStart: (conversationId: string, message: string, code?: string) => void
  notifyActiveRun: () => void
  notifyError: (message: string, code?: string) => void
  uploadImage: (
    conversationId: string,
    image: ChatImageAttachmentInput
  ) => Promise<ChatImageAttachment>
  sendMessage: (
    conversationId: string,
    content: string,
    options?: SendConversationMessageOptions
  ) => Promise<ConversationMessagesResponse>
  onSuccess: (result: ConversationMessagesResponse) => void | Promise<void>
}

export async function submitWorkbenchMessage({
  activeConversationId,
  failRunStart,
  hasActiveRun,
  input,
  markRunSubmitted,
  notifyActiveRun,
  notifyError,
  onSuccess,
  sendMessage,
  setDraft,
  uploadImage,
}: SubmitWorkbenchMessageOptions): Promise<void> {
  if (!activeConversationId) return

  const trimmedContent = input.content.trim()
  const images = input.images ?? []
  if (!trimmedContent && images.length === 0) return

  if (hasActiveRun) {
    notifyActiveRun()
    return
  }

  markRunSubmitted(activeConversationId)

  try {
    const uploadedImages = images.length > 0
      ? await Promise.all(
        images.map((image) =>
          uploadImage(activeConversationId, image)
        )
      )
      : []
    const attachments = uploadedImages.map((image) => ({
      kind: "image" as const,
      assetId: image.assetId,
    }))
    const addressedAgentIds = input.addressedAgentIds?.filter(Boolean) ?? []
    const sendOptions = {
      ...(addressedAgentIds.length ? { addressedAgentIds } : {}),
      ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
      ...(attachments.length ? { attachments } : {}),
    }
    const result = await sendMessage(
      activeConversationId,
      trimmedContent,
      Object.keys(sendOptions).length ? sendOptions : undefined
    )

    await onSuccess(result)
    setDraft(activeConversationId, "")
  } catch (err) {
    const message = err instanceof Error ? err.message : "Run 创建失败"
    const code = err instanceof ConversationMessageRequestError ? err.code : undefined
    failRunStart(activeConversationId, message, code)
    notifyError(message, code)
    throw err
  }
}
