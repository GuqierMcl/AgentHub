import { describe, expect, it } from "bun:test"

import type { HubRunEventEnvelope } from "../api/messages"
import type { RuntimeRunEvent } from "../api/runtime-runs"
import {
  coalesceRunEventEnvelopes,
  getConsumedRuntimeEventIds,
} from "./run-event-coalescing"

function envelope(
  sequence: number,
  event: Partial<RuntimeRunEvent> & {
    id: string
    type: string
    data?: unknown
  }
): HubRunEventEnvelope {
  return {
    sequence,
    event: {
      runId: "run_1",
      runtimeRunId: "runtime_1",
      timestamp: `2026-06-09T10:00:00.${sequence.toString().padStart(3, "0")}Z`,
      agentId: "coder",
      ...event,
    },
  }
}

describe("coalesceRunEventEnvelopes", () => {
  it("combines consecutive message deltas for the same runtime message", () => {
    const result = coalesceRunEventEnvelopes([
      envelope(1, {
        id: "evt_1",
        type: "message.delta",
        messageId: "msg_1",
        messageIndex: 0,
        data: { delta: "Hel" },
      }),
      envelope(2, {
        id: "evt_2",
        type: "message.delta",
        messageId: "msg_1",
        messageIndex: 0,
        data: { delta: "lo" },
      }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0].sequence).toBe(2)
    expect(result[0].event.id).toBe("evt_2")
    expect(result[0].event.data).toMatchObject({ delta: "Hello" })
    expect(getConsumedRuntimeEventIds(result[0].event)).toEqual([
      "evt_1",
      "evt_2",
    ])
  })

  it("does not combine deltas across different messages or terminal boundaries", () => {
    const result = coalesceRunEventEnvelopes([
      envelope(1, {
        id: "evt_1",
        type: "message.delta",
        messageId: "msg_1",
        messageIndex: 0,
        data: { delta: "A" },
      }),
      envelope(2, {
        id: "evt_2",
        type: "message.delta",
        messageId: "msg_2",
        messageIndex: 1,
        data: { delta: "B" },
      }),
      envelope(3, {
        id: "evt_3",
        type: "message.completed",
        messageId: "msg_1",
        messageIndex: 0,
        data: { content: "A" },
      }),
      envelope(4, {
        id: "evt_4",
        type: "message.delta",
        messageId: "msg_1",
        messageIndex: 0,
        data: { delta: "C" },
      }),
    ])

    expect(result.map((item) => item.event.id)).toEqual([
      "evt_1",
      "evt_2",
      "evt_3",
      "evt_4",
    ])
  })

  it("combines consecutive reasoning deltas for the same reasoning block", () => {
    const result = coalesceRunEventEnvelopes([
      envelope(1, {
        id: "evt_1",
        type: "reasoning.delta",
        messageId: "msg_1",
        data: { reasoningId: "r1", delta: "Thinking" },
      }),
      envelope(2, {
        id: "evt_2",
        type: "reasoning.delta",
        messageId: "msg_1",
        data: { reasoningId: "r1", delta: "..." },
      }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0].event.data).toMatchObject({
      reasoningId: "r1",
      delta: "Thinking...",
    })
    expect(getConsumedRuntimeEventIds(result[0].event)).toEqual([
      "evt_1",
      "evt_2",
    ])
  })
})
