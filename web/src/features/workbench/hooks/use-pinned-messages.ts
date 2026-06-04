import { useCallback, useEffect, useState } from "react"
import { messagePinApi, type MessagePin } from "../api/messages"

export function usePinnedMessages(conversationId: string | undefined) {
  const [pins, setPins] = useState<MessagePin[]>([])
  const [loading, setLoading] = useState(false)

  const fetchPins = useCallback(async () => {
    if (!conversationId) return
    setLoading(true)
    try {
      const { pins: fetchedPins } = await messagePinApi.list(conversationId)
      setPins(fetchedPins)
    } catch {
      // silently fail - pins are non-critical
    } finally {
      setLoading(false)
    }
  }, [conversationId])

  useEffect(() => {
    void fetchPins()
  }, [fetchPins])

  const pinnedMessageIds = new Set(pins.map((pin) => pin.messageId))

  const togglePin = useCallback(
    async (messageId: string) => {
      if (!conversationId) return
      const existing = pins.find((pin) => pin.messageId === messageId)
      if (existing) {
        await messagePinApi.delete(existing.id)
        setPins((prev) => prev.filter((pin) => pin.id !== existing.id))
      } else {
        await messagePinApi.create(conversationId, messageId)
        await fetchPins()
      }
    },
    [conversationId, fetchPins, pins]
  )

  return { pins, pinnedMessageIds, loading, togglePin, refresh: fetchPins }
}
