import type { RunEvent } from "./types"

export type ModelAttempt = {
  id: string
}

type PreVisibleFallbackOptions<TAttempt extends ModelAttempt> = {
  primary?: TAttempt
  getPrimary?: () => TAttempt
  getFallback: (error: unknown, failedAttempt?: TAttempt) => TAttempt | null
  executeAttempt: (attempt: TAttempt) => AsyncIterable<RunEvent>
}

export async function* runWithPreVisibleFallback<TAttempt extends ModelAttempt>(
  options: PreVisibleFallbackOptions<TAttempt>
): AsyncIterable<RunEvent> {
  let primary: TAttempt
  try {
    primary = options.primary ?? options.getPrimary?.()!
  } catch (error) {
    const fallback = options.getFallback(error)
    if (!fallback) {
      throw error
    }
    yield* options.executeAttempt(fallback)
    return
  }

  const bufferedEvents: RunEvent[] = []
  let visibleEventEmitted = false

  try {
    for await (const event of options.executeAttempt(primary)) {
      if (!visibleEventEmitted && !isVisibleBarrierEvent(event)) {
        bufferedEvents.push(event)
        continue
      }

      if (!visibleEventEmitted) {
        visibleEventEmitted = true
        for (const buffered of bufferedEvents) {
          yield buffered
        }
      }

      yield event
    }

    for (const buffered of bufferedEvents) {
      yield buffered
    }
  } catch (error) {
    if (visibleEventEmitted) {
      throw error
    }

    const fallback = options.getFallback(error, primary)
    if (!fallback) {
      throw error
    }

    yield* options.executeAttempt(fallback)
  }
}

function isVisibleBarrierEvent(event: RunEvent): boolean {
  return event.type.startsWith("message.") ||
    event.type.startsWith("tool.") ||
    event.type.startsWith("reasoning.") ||
    event.type.startsWith("permission.") ||
    event.type.startsWith("question.")
}
