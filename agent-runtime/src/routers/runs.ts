import { Hono, type Context } from "hono"
import { AgentRegistry } from "../agents"
import { createChildLogger } from "../logger"
import {
  RunInputSchema,
  RunInputValidationError,
  RunManager,
  isTerminalRunEvent,
  isTerminalStatus,
  type RunEvent,
  RuntimePermissionError,
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
    log.info({ input: result.data }, "Creating run with input")
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
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false

      const close = () => {
        if (!closed) {
          closed = true
          unsubscribe?.()
          controller.close()
          log.info({ runId }, "SSE stream closed")
        }
      }

      const send = (event: RunEvent) => {
        if (closed) {
          return
        }
        controller.enqueue(encodeSseEvent(event))
        log.debug({ runId, eventType: event.type, eventId: event.id }, "SSE event sent")
        if (isTerminalRunEvent(event)) {
          log.info({ runId, eventType: event.type }, "Terminal event reached, closing stream")
          close()
        }
      }

      for (const event of existingEvents) {
        send(event)
      }

      const run = manager.getRun(runId)
      if (!run || isTerminalStatus(run.status)) {
        log.info({ runId, status: run?.status }, "Run already completed, closing stream")
        close()
        return
      }

      unsubscribe = manager.subscribe(runId, send)
      log.info({ runId }, "Subscribed to run events")
    },
    cancel() {
      log.info({ runId }, "SSE stream cancelled by client")
      unsubscribe?.()
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

  const run = c.get("runManager").getRun(runId)
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

runs.post("/runtime/runs/:runId/cancel", (c: Context) => {
  const runId = c.req.param("runId")
  log.info({ runId }, "POST /runtime/runs/:runId/cancel - cancelling run")

  const run = c.get("runManager").cancelRun(runId)
  if (!run) {
    log.warn({ runId }, "Run not found for cancellation")
    return runNotFound(c, runId)
  }

  log.info({ runId, status: run.status }, "Run cancelled successfully")
  return c.json(run)
})

export default runs
