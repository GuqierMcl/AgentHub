import { Hono, type Context } from "hono"
import { AgentRegistry } from "../agents"
import { createChildLogger } from "../logger"
import {
  RunInputSchema,
  RunInputValidationError,
  RunManager,
  RunWorkspaceValidationError,
  isTerminalRunEvent,
  isTerminalStatus,
  type RunEvent,
  RuntimePermissionError,
  RuntimeQuestionError,
  QuestionAnswerRequestSchema,
} from "../runtime"
import { z } from "zod"

const log = createChildLogger("runs")

declare module "hono" {
  interface ContextVariableMap {
    agentRegistry: AgentRegistry
    runManager: RunManager
  }
}

const runs = new Hono()
const PermissionDecisionSchema = z.object({
  approved: z.boolean(),
  reason: z.string().trim().min(1).optional(),
}).strict()
const SSE_KEEPALIVE_INTERVAL_MS = 5_000

function invalidRunInput(c: Context, details: unknown) {
  return c.json({
    error: {
      code: "RUN_INVALID_INPUT",
      message: "Invalid run input",
      details,
    },
  }, 400)
}

function runNotFound(c: Context, runId: string) {
  return c.json({
    error: {
      code: "RUN_NOT_FOUND",
      message: `Run ${runId} not found`,
    },
  }, 404)
}

function registryUnavailable(c: Context) {
  return c.json({
    error: {
      code: "AGENT_REGISTRY_UNAVAILABLE",
      message: "Agent registry is not initialized",
    },
  }, 503)
}

function runValidationError(c: Context, error: RunInputValidationError) {
  return c.json({
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  }, 400)
}

function encodeSseEvent(event: RunEvent): Uint8Array {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  return new TextEncoder().encode(payload)
}

function encodeSseComment(comment: string): Uint8Array {
  return new TextEncoder().encode(`: ${comment}\n\n`)
}

runs.post("/runtime/runs", async (c: Context) => {
  log.info("POST /runtime/runs - creating new run")

  const registry = c.get("agentRegistry")
  if (!registry.isInitialized()) {
    log.warn("Agent registry not initialized")
    return registryUnavailable(c)
  }

  const body = await c.req.json().catch(() => null)
  const result = RunInputSchema.safeParse(body)
  if (!result.success) {
    log.warn({ issues: result.error.issues }, "Invalid run input")
    return invalidRunInput(c, result.error.issues)
  }

  try {
    log.info({
      conversationId: result.data.conversationId,
      mode: result.data.mode,
      participantAgentIds: result.data.participantAgentIds,
      workspaceId: result.data.workspace?.workspaceId,
    }, "Creating run with input")
    const run = c.get("runManager").createRun(result.data)
    log.info({ runId: run.id, entryAgentIds: run.entryAgentIds, entryReason: run.entryReason }, "Run created successfully")
    return c.json({
      runId: run.id,
      status: "queued",
      entryAgentIds: run.entryAgentIds,
      entryReason: run.entryReason,
      eventsUrl: `/runtime/runs/${run.id}/events`,
    }, 201)
  } catch (error) {
    if (error instanceof RunInputValidationError) {
      log.warn({ code: error.code, message: error.message }, "Run input validation failed")
      return runValidationError(c, error)
    }
    if (error instanceof RunWorkspaceValidationError) {
      return c.json({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      }, 400)
    }
    log.error({ error }, "Failed to create run")
    throw error
  }
})

runs.get("/runtime/runs/:runId/events", (c: Context) => {
  const runId = c.req.param("runId")
  log.info({ runId }, "GET /runtime/runs/:runId/events - streaming events")

  const manager = c.get("runManager")
  const existingEvents = manager.getEvents(runId)
  if (!existingEvents) {
    log.warn({ runId }, "Run not found for events stream")
    return runNotFound(c, runId)
  }

  log.info({ runId, existingEventCount: existingEvents.length }, "Starting SSE stream")

  let unsubscribe: (() => void) | undefined
  let closed = false
  let terminalSent = false
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
          log.info({ runId }, "SSE stream closed")
        }
      }

      const sendKeepAlive = () => {
        if (closed) {
          return
        }
        controller.enqueue(encodeSseComment("keepalive"))
        log.debug({ runId }, "SSE keepalive sent")
      }

      const send = (event: RunEvent): boolean => {
        if (closed || sentEventIds.has(event.id)) {
          return false
        }
        sentEventIds.add(event.id)
        controller.enqueue(encodeSseEvent(event))
        log.debug({ runId, eventType: event.type, eventId: event.id }, "SSE event sent")
        if (isTerminalRunEvent(event)) {
          terminalSent = true
          log.info({ runId, eventType: event.type }, "Terminal event reached, closing stream")
          close()
        }
        return true
      }

      sendKeepAlive()
      keepAliveTimer = setInterval(sendKeepAlive, SSE_KEEPALIVE_INTERVAL_MS)

      const replayExistingEvents = (phase: "initial" | "terminal-drain"): boolean => {
        const events = manager.getEvents(runId)
        if (!events) {
          log.warn({ runId, phase }, "Run disappeared while replaying SSE events")
          close()
          return false
        }

        let sentCount = 0
        let reachedTerminal = false
        for (const event of events) {
          if (send(event)) {
            sentCount += 1
          }
          if (isTerminalRunEvent(event)) {
            reachedTerminal = true
            break
          }
        }
        log.info(
          { runId, phase, replayEventCount: events.length, sentCount, reachedTerminal },
          "SSE replay pass completed"
        )
        return reachedTerminal
      }

      unsubscribe = manager.subscribe(runId, send)
      log.info({ runId }, "Subscribed to run events")

      const reachedTerminal = replayExistingEvents("initial")
      const run = manager.getRun(runId)
      if (!run) {
        log.info({ runId }, "Run missing after SSE replay, closing stream")
        close()
        return
      }

      if (reachedTerminal) {
        close()
        return
      }

      if (isTerminalStatus(run.status)) {
        const drainedTerminal = replayExistingEvents("terminal-drain")
        if (!drainedTerminal) {
          log.warn(
            { runId, status: run.status, sentEventCount: sentEventIds.size },
            "Run status is terminal but SSE replay did not include a terminal event"
          )
        }
        log.info({ runId, status: run.status }, "Run already completed, closing stream")
        close()
      }
    },
    cancel(reason) {
      log.info(
        { runId, terminalSent, reason },
        "SSE stream consumer disconnected"
      )
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

runs.get("/runtime/runs/:runId", (c: Context) => {
  const runId = c.req.param("runId")
  log.info({ runId }, "GET /runtime/runs/:runId - getting run status")

  const run = c.get("runManager").getRunResponse(runId)
  if (!run) {
    log.warn({ runId }, "Run not found")
    return runNotFound(c, runId)
  }

  log.info({ runId, status: run.status }, "Run status retrieved")
  return c.json(run)
})

runs.get("/runtime/runs/:runId/permissions", (c: Context) => {
  const runId = c.req.param("runId")
  const manager = c.get("runManager")
  if (!manager.getRun(runId)) {
    return runNotFound(c, runId)
  }
  return c.json({
    permissions: manager.listPermissions(runId),
  })
})

runs.post("/runtime/runs/:runId/permissions/:requestId/decision", async (c: Context) => {
  const runId = c.req.param("runId")
  const requestId = c.req.param("requestId")
  const body = await c.req.json().catch(() => null)
  const parsed = PermissionDecisionSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({
      error: {
        code: "PERMISSION_INVALID_INPUT",
        message: "Invalid permission decision input",
        details: parsed.error.issues,
      },
    }, 400)
  }

  try {
    return c.json(c.get("runManager").decidePermission(
      runId,
      requestId,
      parsed.data.approved,
      parsed.data.reason
    ))
  } catch (error) {
    if (error instanceof RuntimePermissionError) {
      return c.json({
        error: {
          code: error.code,
          message: error.message,
        },
      }, error.status)
    }
    throw error
  }
})

runs.post("/runtime/runs/:runId/questions/:requestId/answer", async (c: Context) => {
  const runId = c.req.param("runId")
  const requestId = c.req.param("requestId")
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
    return c.json(c.get("runManager").answerQuestion(
      runId,
      requestId,
      parsed.data.answers
    ))
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

runs.post("/runtime/runs/:runId/cancel", async (c: Context) => {
  const runId = c.req.param("runId")
  log.info({ runId }, "POST /runtime/runs/:runId/cancel - cancelling run")

  const run = await c.get("runManager").cancelRun(runId)
  if (!run) {
    log.warn({ runId }, "Run not found for cancellation")
    return runNotFound(c, runId)
  }

  log.info({ runId, status: run.status }, "Run cancelled successfully")
  return c.json(c.get("runManager").getRunResponse(runId) ?? run)
})

export default runs
