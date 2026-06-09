import type { ExternalContextPacket, RuntimeMessage } from "../types"
import type { ExternalAdapterContext } from "./types"

const MAX_FALLBACK_HISTORY_MESSAGES = 20
const MAX_FALLBACK_MESSAGE_CHARS = 4_000

export function resolveExternalAdapterContextPacket(
  context: ExternalAdapterContext,
  provider: ExternalContextPacket["provider"]
): ExternalContextPacket | undefined {
  const supplied = context.input.externalContext?.find((packet) =>
    packet.provider === provider &&
    packet.agentId === context.agent.id &&
    packet.scope === context.scope
  )
  if (supplied) {
    return supplied
  }

  return createFallbackExternalContextPacket(context, provider)
}

function createFallbackExternalContextPacket(
  context: ExternalAdapterContext,
  provider: ExternalContextPacket["provider"]
): ExternalContextPacket | undefined {
  const history = context.input.history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-MAX_FALLBACK_HISTORY_MESSAGES)
  if (history.length === 0) {
    return undefined
  }

  return {
    provider,
    agentId: context.agent.id,
    scope: context.scope,
    mode: "bootstrap",
    messages: history.map((message, index) => ({
      id: message.id ?? `history_${index + 1}`,
      role: message.role as "user" | "assistant",
      ...(message.agentId ? { agentId: message.agentId } : {}),
      content: truncateMessageContent(message),
    })),
    handoffSummaries: [],
  }
}

function truncateMessageContent(message: RuntimeMessage): string {
  const normalized = message.content.trim()
  if (normalized.length <= MAX_FALLBACK_MESSAGE_CHARS) {
    return normalized
  }
  return `${normalized.slice(0, MAX_FALLBACK_MESSAGE_CHARS)}...`
}
