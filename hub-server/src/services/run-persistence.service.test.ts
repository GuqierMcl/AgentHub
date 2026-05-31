import { describe, expect, it } from 'bun:test'
import {
  RuntimeEventBatcher,
  isRetryableRuntimeEventStreamError,
  resolveAddressedAgentIds,
  toProductHubRunEventEnvelope,
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

describe('toProductHubRunEventEnvelope', () => {
  it('projects bash tool output to a bounded UI preview', () => {
    const stdout = 'x'.repeat(13_000)
    const stderr = 'error'.repeat(3_000)
    const envelope = toProductHubRunEventEnvelope({
      sequence: 1,
      event: {
        id: 'event_bash_completed',
        runId: 'run_bash',
        type: 'tool.completed',
        timestamp: new Date().toISOString(),
        agentId: 'coder',
        toolCallId: 'tool_bash',
        toolName: 'bash',
        data: {
          status: 'completed',
          summary: 'bash exited with code 0',
          data: {
            command: 'npm test',
            cwd: '.',
            shell: 'powershell.exe',
            exitCode: 0,
            signal: null,
            stdout,
            stderr,
            stdoutBytes: stdout.length,
            stderrBytes: stderr.length,
            truncated: false,
            durationMs: 42,
          },
        },
      },
    })

    const eventData = envelope.event.data as { data: Record<string, unknown> }
    expect((eventData.data.stdout as string).length).toBe(12_000)
    expect((eventData.data.stderr as string).length).toBe(12_000)
    expect(eventData.data.stdoutCharacters).toBe(stdout.length)
    expect(eventData.data.stderrCharacters).toBe(stderr.length)
    expect(eventData.data.stdoutTruncatedForUi).toBe(true)
    expect(eventData.data.stderrTruncatedForUi).toBe(true)
  })
})

describe('resolveAddressedAgentIds', () => {
  it('keeps default routing when no addressed agent is provided', () => {
    expect(resolveAddressedAgentIds({
      mode: 'group',
      agents: [
        { agentId: 'orchestrator' },
        { agentId: 'coder' },
      ],
    }, undefined)).toEqual([])
  })

  it('allows one conversation member to be addressed in a group chat', () => {
    expect(resolveAddressedAgentIds({
      mode: 'group',
      agents: [
        { agentId: 'orchestrator' },
        { agentId: 'coder' },
      ],
    }, ['coder'])).toEqual(['coder'])
  })

  it('rejects duplicate and multiple addressed agents', () => {
    expect(() => resolveAddressedAgentIds({
      mode: 'group',
      agents: [
        { agentId: 'orchestrator' },
        { agentId: 'coder' },
        { agentId: 'writer' },
      ],
    }, ['coder', 'coder'])).toThrow('Addressed agents must be unique')

    expect(() => resolveAddressedAgentIds({
      mode: 'group',
      agents: [
        { agentId: 'orchestrator' },
        { agentId: 'coder' },
        { agentId: 'writer' },
      ],
    }, ['coder', 'writer'])).toThrow('Only one addressed agent is supported in this version')
  })

  it('rejects addressed agents outside the conversation', () => {
    expect(() => resolveAddressedAgentIds({
      mode: 'group',
      agents: [
        { agentId: 'orchestrator' },
        { agentId: 'coder' },
      ],
    }, ['writer'])).toThrow('Addressed agent must be a conversation member')
  })

  it('only allows a single chat to address its only member', () => {
    expect(resolveAddressedAgentIds({
      mode: 'single',
      agents: [
        { agentId: 'coder' },
      ],
    }, ['coder'])).toEqual(['coder'])

    expect(() => resolveAddressedAgentIds({
      mode: 'single',
      agents: [
        { agentId: 'coder' },
        { agentId: 'writer' },
      ],
    }, ['coder'])).toThrow('Single chat can only address its only member')
  })
})
