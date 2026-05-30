import { Hono, Context } from 'hono'
import type { HubEventBus, HubGlobalEventEnvelope } from '../services/hub-event-bus.service'

declare module 'hono' {
  interface ContextVariableMap {
    hubEventBus: HubEventBus
  }
}

const HEARTBEAT_INTERVAL_MS = 25_000

const events = new Hono()
const encoder = new TextEncoder()

function encodeHubEvent(event: HubGlobalEventEnvelope): Uint8Array {
  return encoder.encode(`event: hub.event\ndata: ${JSON.stringify(event)}\n\n`)
}

function encodeHeartbeat(): Uint8Array {
  return encoder.encode(`: heartbeat ${new Date().toISOString()}\n\n`)
}

events.get('/api/events', (c: Context) => {
  const hubEventBus = c.get('hubEventBus')

  let unsubscribe: (() => void) | undefined
  let heartbeatId: ReturnType<typeof setInterval> | undefined
  let closed = false

  const cleanup = () => {
    if (closed) return
    closed = true
    unsubscribe?.()
    unsubscribe = undefined
    if (heartbeatId) {
      clearInterval(heartbeatId)
      heartbeatId = undefined
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        cleanup()
        try {
          controller.close()
        } catch {
          // The stream may already be closed by the client.
        }
      }

      unsubscribe = hubEventBus.subscribe((event: HubGlobalEventEnvelope) => {
        if (closed) return
        try {
          controller.enqueue(encodeHubEvent(event))
        } catch {
          close()
        }
      })

      controller.enqueue(encodeHeartbeat())
      heartbeatId = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encodeHeartbeat())
        } catch {
          close()
        }
      }, HEARTBEAT_INTERVAL_MS)

      c.req.raw.signal.addEventListener('abort', close, { once: true })
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})

export default events
