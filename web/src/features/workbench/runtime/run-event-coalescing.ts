import type { HubRunEventEnvelope } from "../api/messages"
import type { RuntimeRunEvent } from "../api/runtime-runs"

const COALESCED_EVENT_IDS_KEY = "__agenthubCoalescedEventIds"

export function coalesceRunEventEnvelopes(
  envelopes: HubRunEventEnvelope[]
): HubRunEventEnvelope[] {
  const result: HubRunEventEnvelope[] = []

  for (const envelope of envelopes) {
    const previous = result.at(-1)
    if (!previous || !canCoalesceDelta(previous.event, envelope.event)) {
      result.push(envelope)
      continue
    }

    result[result.length - 1] = mergeDeltaEnvelope(previous, envelope)
  }

  return result
}

export function getConsumedRuntimeEventIds(event: RuntimeRunEvent): string[] {
  const data = getRecord(event.data)
  const ids = data?.[COALESCED_EVENT_IDS_KEY]
  if (!Array.isArray(ids)) return [event.id]

  const consumed = ids.filter((id): id is string =>
    typeof id === "string" && id.length > 0
  )
  return consumed.length ? consumed : [event.id]
}

function canCoalesceDelta(
  left: RuntimeRunEvent,
  right: RuntimeRunEvent
): boolean {
  if (!isDeltaEvent(left) || !isDeltaEvent(right)) return false
  if (left.type !== right.type) return false

  const leftData = getRecord(left.data)
  const rightData = getRecord(right.data)
  if (!leftData || !rightData) return false
  if (typeof leftData.delta !== "string" || typeof rightData.delta !== "string") {
    return false
  }

  return getDeltaCoalesceKey(left) === getDeltaCoalesceKey(right)
}

function mergeDeltaEnvelope(
  left: HubRunEventEnvelope,
  right: HubRunEventEnvelope
): HubRunEventEnvelope {
  const leftData = getRecord(left.event.data) ?? {}
  const rightData = getRecord(right.event.data) ?? {}
  const delta = `${leftData.delta ?? ""}${rightData.delta ?? ""}`
  const consumedEventIds = [
    ...getConsumedRuntimeEventIds(left.event),
    ...getConsumedRuntimeEventIds(right.event),
  ]

  return {
    sequence: right.sequence,
    event: {
      ...left.event,
      ...right.event,
      data: {
        ...leftData,
        ...rightData,
        delta,
        [COALESCED_EVENT_IDS_KEY]: consumedEventIds,
      },
    },
  }
}

function isDeltaEvent(event: RuntimeRunEvent): boolean {
  return event.type === "message.delta" || event.type === "reasoning.delta"
}

function getDeltaCoalesceKey(event: RuntimeRunEvent): string {
  const data = getRecord(event.data)
  const parts = [
    event.type,
    event.runId,
    event.runtimeRunId ?? "",
    event.agentId ?? "",
    event.parentAgentId ?? "",
    event.parentTaskId ?? "",
    event.taskId ?? "",
    event.groupId ?? "",
    event.toolCallId ?? "",
    event.toolName ?? "",
    event.messageId ?? "",
    event.messageIndex ?? "",
    event.type === "reasoning.delta" ? getString(data?.reasoningId) ?? "default" : "",
  ]
  return JSON.stringify(parts)
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}
