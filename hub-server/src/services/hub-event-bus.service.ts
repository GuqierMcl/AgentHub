import { generateId } from '../lib/id'

export type HubGlobalEventType =
  | 'conversation.updated'
  | 'conversation.title.updated'
  | 'conversation.last_message.updated'
  | 'run.status.changed'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'

export type HubGlobalEventEnvelope = {
  id: string
  type: HubGlobalEventType
  timestamp: string
  data: Record<string, unknown>
}

type HubGlobalEventListener = (event: HubGlobalEventEnvelope) => void

export class HubEventBus {
  private listeners = new Set<HubGlobalEventListener>()

  publish(
    type: HubGlobalEventType,
    data: Record<string, unknown> = {},
  ): HubGlobalEventEnvelope {
    const event: HubGlobalEventEnvelope = {
      id: generateId('evt'),
      type,
      timestamp: new Date().toISOString(),
      data,
    }

    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Global events are best-effort; one broken subscriber must not block others.
      }
    }

    return event
  }

  subscribe(listener: HubGlobalEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
