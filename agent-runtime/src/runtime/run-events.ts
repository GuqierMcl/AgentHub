import type { RunEvent, RunEventType } from "./types"

export function createRunEvent(
  runId: string,
  type: RunEventType,
  agentId?: string,
  data?: unknown
): RunEvent {
  return {
    id: crypto.randomUUID(),
    runId,
    type,
    timestamp: new Date().toISOString(),
    agentId,
    data,
  }
}

export function isTerminalRunEvent(event: RunEvent): boolean {
  return event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.cancelled"
}

export function isTerminalStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled"
}

