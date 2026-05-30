import { describe, expect, it } from 'bun:test'
import {
  RuntimeEventBatcher,
  isRetryableRuntimeEventStreamError,
} from './run-persistence.service'

describe('RuntimeEventBatcher', () => {
  it('flushes items in arrival order when max batch size is reached', async () => {
    const flushed: number[][] = []
    const batcher = new RuntimeEventBatcher<number>({
      flushIntervalMs: 10_000,
      maxBatchSize: 3,
      maxBufferedItems: 10,
      flush: async (items) => {
        flushed.push(items)
      },
    })

    await batcher.enqueue(1)
    await batcher.enqueue(2)
    await batcher.enqueue(3)
    await batcher.close()

    expect(flushed).toEqual([[1, 2, 3]])
  })

  it('flushes immediately when forceFlush is requested', async () => {
    const flushed: string[][] = []
    const batcher = new RuntimeEventBatcher<string>({
      flushIntervalMs: 10_000,
      maxBatchSize: 10,
      maxBufferedItems: 10,
      flush: async (items) => {
        flushed.push(items)
      },
    })

    await batcher.enqueue('run.started')
    await batcher.enqueue('run.completed', { forceFlush: true })

    expect(flushed).toEqual([['run.started', 'run.completed']])
  })

  it('propagates flush failures to later operations', async () => {
    const batcher = new RuntimeEventBatcher<number>({
      flushIntervalMs: 10_000,
      maxBatchSize: 1,
      maxBufferedItems: 10,
      flush: async () => {
        throw new Error('write failed')
      },
    })

    await expect(batcher.enqueue(1)).rejects.toThrow('write failed')
    await expect(batcher.enqueue(2)).rejects.toThrow('write failed')
  })
})

describe('isRetryableRuntimeEventStreamError', () => {
  it('treats socket resets from runtime SSE as retryable', () => {
    const error = Object.assign(
      new Error('The socket connection was closed unexpectedly.'),
      { code: 'ECONNRESET' },
    )

    expect(isRetryableRuntimeEventStreamError(error)).toBe(true)
  })

  it('does not retry non-transport parsing errors', () => {
    expect(isRetryableRuntimeEventStreamError(new SyntaxError('bad json'))).toBe(false)
  })
})
