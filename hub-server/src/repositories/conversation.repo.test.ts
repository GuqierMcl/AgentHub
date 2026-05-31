import { describe, expect, it } from 'bun:test'
import { sortConversationListRecords } from './conversation.repo'

describe('sortConversationListRecords', () => {
  it('keeps pinned conversations first and ranks unpinned conversations by last message or creation time', () => {
    const records = [
      conversationRecord('old_empty', {
        createdAt: '2026-05-01T00:00:00.000Z',
      }),
      conversationRecord('recent_messaged', {
        createdAt: '2026-04-01T00:00:00.000Z',
        lastMessageAt: '2026-05-02T00:00:00.000Z',
      }),
      conversationRecord('new_empty', {
        createdAt: '2026-05-03T00:00:00.000Z',
      }),
      conversationRecord('pinned', {
        createdAt: '2026-01-01T00:00:00.000Z',
        pinnedAt: '2026-04-01T00:00:00.000Z',
      }),
    ]

    expect(sortConversationListRecords(records).map((record) => record.id)).toEqual([
      'pinned',
      'new_empty',
      'recent_messaged',
      'old_empty',
    ])
  })

  it('orders pinned conversations by the newest pinned timestamp', () => {
    const records = [
      conversationRecord('older_pin', {
        pinnedAt: '2026-05-01T00:00:00.000Z',
      }),
      conversationRecord('newer_pin', {
        pinnedAt: '2026-05-02T00:00:00.000Z',
      }),
      conversationRecord('new_empty', {
        createdAt: '2026-05-03T00:00:00.000Z',
      }),
    ]

    expect(sortConversationListRecords(records).map((record) => record.id)).toEqual([
      'newer_pin',
      'older_pin',
      'new_empty',
    ])
  })
})

function conversationRecord(
  id: string,
  overrides: Partial<{
    pinnedAt: string | null
    lastMessageAt: string | null
    createdAt: string | null
  }> = {},
) {
  return {
    id,
    pinnedAt: overrides.pinnedAt ?? null,
    lastMessageAt: overrides.lastMessageAt ?? null,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
  }
}
