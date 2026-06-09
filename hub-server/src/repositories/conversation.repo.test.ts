import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, initDatabase } from '../lib/db'
import { prepareTestDatabase } from '../test-utils/database'
import { createMessage } from './message.repo'
import { createMessagePart } from './message-part.repo'
import {
  createConversation,
  listConversationsWithAgents,
  sortConversationListRecords,
  updateConversation,
} from './conversation.repo'

let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'hub-server-conversation-repo-'))
  const dbPath = join(tempDir, 'hub.db').replace(/\\/g, '/')
  const dbUrl = `file:${dbPath}`
  prepareTestDatabase(dbUrl)
  await initDatabase(dbUrl)
})

afterAll(async () => {
  await closeDatabase()
  if (tempDir) {
    try {
      await rm(tempDir, { recursive: true, force: true })
    } catch {
      // SQLite can release WAL file handles slightly after disconnect on Windows.
    }
  }
})

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

describe('listConversationsWithAgents', () => {
  it('uses image fallback text for image-only last message previews', async () => {
    const singleImage = await createConversation({
      title: 'Single image preview',
      mode: 'single',
    })
    const singleMessage = await createMessage({
      conversationId: singleImage.id,
      role: 'user',
      senderType: 'user',
      senderId: 'user',
      status: 'completed',
      completedAt: '2026-06-08T08:00:00.000Z',
    })
    await createMessagePart({
      messageId: singleMessage.id,
      conversationId: singleImage.id,
      partKey: 'image:asset_one',
      partIndex: 0,
      type: 'image',
      state: 'done',
      payloadJson: { kind: 'image', assetId: 'asset_one' },
    })
    await updateConversation(singleImage.id, {
      lastMessageId: singleMessage.id,
      lastMessageAt: '2026-06-08T08:00:00.000Z',
    })

    const multipleImages = await createConversation({
      title: 'Multiple image preview',
      mode: 'single',
    })
    const multipleMessage = await createMessage({
      conversationId: multipleImages.id,
      role: 'user',
      senderType: 'user',
      senderId: 'user',
      status: 'completed',
      completedAt: '2026-06-08T08:01:00.000Z',
    })
    await createMessagePart({
      messageId: multipleMessage.id,
      conversationId: multipleImages.id,
      partKey: 'image:asset_first',
      partIndex: 0,
      type: 'image',
      state: 'done',
      payloadJson: { kind: 'image', assetId: 'asset_first' },
    })
    await createMessagePart({
      messageId: multipleMessage.id,
      conversationId: multipleImages.id,
      partKey: 'image:asset_second',
      partIndex: 1,
      type: 'image',
      state: 'done',
      payloadJson: { kind: 'image', assetId: 'asset_second' },
    })
    await updateConversation(multipleImages.id, {
      lastMessageId: multipleMessage.id,
      lastMessageAt: '2026-06-08T08:01:00.000Z',
    })

    const previews = new Map(
      (await listConversationsWithAgents({ limit: 50 })).map((conversation) => [
        conversation.id,
        conversation.lastMessageContent,
      ]),
    )

    expect(previews.get(singleImage.id)).toBe('[图片]')
    expect(previews.get(multipleImages.id)).toBe('[2 张图片]')
  })

  it('prefers text content when the last message also has image parts', async () => {
    const conversation = await createConversation({
      title: 'Text and image preview',
      mode: 'single',
    })
    const message = await createMessage({
      conversationId: conversation.id,
      role: 'user',
      senderType: 'user',
      senderId: 'user',
      status: 'completed',
      completedAt: '2026-06-08T08:02:00.000Z',
    })
    await createMessagePart({
      messageId: message.id,
      conversationId: conversation.id,
      partKey: 'text',
      partIndex: 0,
      type: 'text',
      state: 'done',
      text: 'Describe this mixed message.',
    })
    await createMessagePart({
      messageId: message.id,
      conversationId: conversation.id,
      partKey: 'image:asset_text_image',
      partIndex: 1,
      type: 'image',
      state: 'done',
      payloadJson: { kind: 'image', assetId: 'asset_text_image' },
    })
    await updateConversation(conversation.id, {
      lastMessageId: message.id,
      lastMessageAt: '2026-06-08T08:02:00.000Z',
    })

    const listed = (await listConversationsWithAgents({ limit: 50 }))
      .find((item) => item.id === conversation.id)

    expect(listed?.lastMessageContent).toBe('Describe this mixed message.')
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
