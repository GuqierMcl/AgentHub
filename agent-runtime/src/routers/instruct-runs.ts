import { Hono, type Context } from "hono"
import { z } from "zod"
import { createChildLogger } from "../logger"
import {
  InstructRunInputSchema,
  type InstructRunStatus,
} from "../instruct-runtime/types"
import { InstructAgentRegistry } from "../agents/instruct-agent-registry"
import { InstructRunManager } from "../instruct-runtime"
import {
  QuestionAnswerRequestSchema,
  RuntimeQuestionError,
} from "../runtime/question"
import type { RunEvent } from "../runtime/types"
import { isTerminalRunEvent, isTerminalStatus } from "../runtime/run-events"

const log = createChildLogger("instruct-runs")

declare module "hono" {
  interface ContextVariableMap {
    instructAgentRegistry: InstructAgentRegistry
    instructRunManager: InstructRunManager
  }
}

const instructRuns = new Hono()
const SSE_KEEPALIVE_INTERVAL_MS = 5_000

function encodeSseEvent(event: RunEvent): Uint8Array {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  return new TextEncoder().encode(payload)
}

function encodeSseComment(comment: string): Uint8Array {
  return new TextEncoder().encode(`: ${comment}\n\n`)
}

instructRuns.post("/runtime/instruct-runs", async (c: Context) => {
  const body = await c.req.json().catch(() => null)
  const result = InstructRunInputSchema.safeParse(body)

  if (!result.success) {
    return c.json({
      error: {
        code: "INSTRUCT_RUN_INVALID_INPUT",
        message: "Invalid instruct run input",
        details: result.error.issues,
      },
    }, 400)
  }

  const manager = c.get("instructRunManager")
  const createResponse = manager.createRun(result.data)

  log.info({ runId: createResponse.runId }, "Instruct run created via POST")
  return c.json(createResponse, 201)
})

instructRuns.get("/runtime/instruct-runs/:runId/events", (c: Context) => {
  const runId = c.req.param("runId")!!
  const manager = c.get("instructRunManager")

  const existingEvents = manager.getEvents(runId)
  if (!existingEvents) {
    return c.json({
      error: {
        code: "RUN_NOT_FOUND",
        message: `Run ${runId} not found`,
      },
    }, 404)
  }

  let unsubscribe: (() => void) | undefined
  let closed = false
  let keepAliveTimer: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sentEventIds = new Set<string>()

      const cleanup = () => {
        unsubscribe?.()
        if (keepAliveTimer) {
          clearInterval(keepAliveTimer)
          keepAliveTimer = undefined
        }
      }

      const close = () => {
        if (!closed) {
          closed = true
          cleanup()
          controller.close()
        }
      }

      const sendKeepAlive = () => {
        if (closed) {
          return
        }
        controller.enqueue(encodeSseComment("keepalive"))
      }

      const send = (event: RunEvent): boolean => {
        if (closed || sentEventIds.has(event.id)) {
          return false
        }
        sentEventIds.add(event.id)
        controller.enqueue(encodeSseEvent(event))
        if (isTerminalRunEvent(event)) {
          close()
        }
        return true
      }

      sendKeepAlive()
      keepAliveTimer = setInterval(sendKeepAlive, SSE_KEEPALIVE_INTERVAL_MS)

      const replayExistingEvents = (): boolean => {
        const events = manager.getEvents(runId)
        if (!events) {
          close()
          return false
        }

        let reachedTerminal = false
        for (const event of events) {
          if (send(event)) {}
          if (isTerminalRunEvent(event)) {
            reachedTerminal = true
            break
          }
        }
        return reachedTerminal
      }

      unsubscribe = manager.subscribe(runId, send) ?? (() => {})

      const reachedTerminal = replayExistingEvents()
      const run = manager.getRun(runId)
      if (!run) {
        close()
        return
      }

      if (reachedTerminal) {
        close()
        return
      }

      if (isTerminalStatus(run.status)) {
        replayExistingEvents()
        close()
      }
    },
    cancel() {
      if (!closed) {
        closed = true
      }
      unsubscribe?.()
      if (keepAliveTimer) {
        clearInterval(keepAliveTimer)
        keepAliveTimer = undefined
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  })
})

instructRuns.get("/runtime/instruct-runs/:runId", (c: Context) => {
  const runId = c.req.param("runId")!
  const run = c.get("instructRunManager").getRun(runId)
  if (!run) {
    return c.json({
      error: {
        code: "RUN_NOT_FOUND",
        message: `Run ${runId} not found`,
      },
    }, 404)
  }
  return c.json(run)
})

instructRuns.post("/runtime/instruct-runs/:runId/questions/:requestId/answer", async (c: Context) => {
  const runId = c.req.param("runId")!
  const requestId = c.req.param("requestId")!
  const body = await c.req.json().catch(() => null)
  const parsed = QuestionAnswerRequestSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({
      error: {
        code: "QUESTION_INVALID_INPUT",
        message: "Invalid question answer input",
        details: parsed.error.issues,
      },
    }, 400)
  }

  try {
    const result = c.get("instructRunManager").answerQuestion(runId, requestId, parsed.data.answers)
    return c.json(result)
  } catch (error) {
    if (error instanceof RuntimeQuestionError) {
      return c.json({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      }, error.status)
    }
    throw error
  }
})

instructRuns.post("/runtime/instruct-runs/:runId/cancel", async (c: Context) => {
  const runId = c.req.param("runId")!
  const run = c.get("instructRunManager").cancelRun(runId)
  if (!run) {
    return c.json({
      error: {
        code: "RUN_NOT_FOUND",
        message: `Run ${runId} not found`,
      },
    }, 404)
  }
  return c.json(run)
})

export default instructRuns
