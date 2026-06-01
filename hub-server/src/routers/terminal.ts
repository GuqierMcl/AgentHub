import { Hono, Context } from "hono"
import { createBunWebSocket } from "hono/bun"
import { z } from "zod"

import { findConversationById } from "../repositories/conversation.repo"
import { logger } from "../lib/logger"
import { badRequest, notFound, conflict } from "../lib/errors"
import type { TerminalService } from "../services/terminal/terminal.service"
import type { TerminalWsMessage } from "../services/terminal/types"

export const { upgradeWebSocket, websocket } = createBunWebSocket()

declare module "hono" {
  interface ContextVariableMap {
    terminalService: TerminalService
  }
}

const CreateTerminalSchema = z.object({
  cols: z.number().int().min(10).max(500).default(80),
  rows: z.number().int().min(4).max(200).default(24),
})

const terminal = new Hono()

terminal.post("/api/conversations/:conversationId/terminals", async (c: Context) => {
  const conversationId = c.req.param("conversationId")
  if (!conversationId) throw badRequest("MISSING_PARAM", "缺少会话 ID")

  const terminalService = c.get("terminalService")

  const conversation = await findConversationById(conversationId)
  if (!conversation) {
    throw notFound("CONVERSATION_NOT_FOUND", "会话不存在")
  }

  const workspace = (conversation.metadataJson?.workspace ?? null) as Record<string, unknown> | null
  if (!workspace || typeof workspace.rootPath !== "string" || !workspace.rootPath) {
    throw badRequest("NO_WORKSPACE", "该会话未设置工作区，无法创建终端")
  }

  if (terminalService.hasReachedLimit(conversationId)) {
    throw conflict("TERMINAL_LIMIT_REACHED", "该会话的终端会话数已达上限")
  }

  const body = await c.req.json().catch(() => ({}))
  const parsed = CreateTerminalSchema.safeParse(body)
  if (!parsed.success) {
    throw badRequest("INVALID_PARAMS", "请求参数无效")
  }

  const { cols, rows } = parsed.data
  const workspaceId = workspace.workspaceId as string
  const workspaceRoot = workspace.rootPath as string

  const sessionInfo = terminalService.createSession(
    conversationId,
    workspaceId,
    workspaceRoot,
    cols,
    rows,
  )

  logger.info({ sessionId: sessionInfo.sessionId, conversationId }, "Terminal session created")

  return c.json({ data: sessionInfo }, 201)
})

terminal.get("/api/conversations/:conversationId/terminals", async (c: Context) => {
  const conversationId = c.req.param("conversationId")
  if (!conversationId) throw badRequest("MISSING_PARAM", "缺少会话 ID")

  const terminalService = c.get("terminalService")

  const conversations = await findConversationById(conversationId)
  if (!conversations) {
    throw notFound("CONVERSATION_NOT_FOUND", "会话不存在")
  }

  const sessions = terminalService.listSessionInfos(conversationId)
  return c.json({ data: sessions })
})

terminal.delete("/api/conversations/:conversationId/terminals/:sessionId", async (c: Context) => {
  const sessionId = c.req.param("sessionId")
  if (!sessionId) throw badRequest("MISSING_PARAM", "缺少会话 ID")

  const terminalService = c.get("terminalService")

  terminalService.closeSession(sessionId)
  logger.info({ sessionId }, "Terminal session closed")

  return c.json({ data: { sessionId, status: "closed" } })
})

terminal.get(
  "/api/terminals/:sessionId/ws",
  upgradeWebSocket((c: Context) => {
    const sessionId = c.req.param("sessionId") ?? ""
    const terminalService = c.get("terminalService")

    return {
      onOpen(_evt, ws) {
        if (!sessionId) {
          try { ws.close() } catch { /* ignore */ }
          return
        }

        const err = terminalService.attachSession(sessionId, {
          send: (data: string) => {
            try {
              ws.send(data)
            } catch {
              // ws may already be closed
            }
          },
          close: () => {
            try {
              ws.close()
            } catch {
              // already closed
            }
          },
        })

        if (err) {
          try {
            ws.send(JSON.stringify(err))
            ws.close()
          } catch {
            // ignore
          }
        }
      },

      onMessage(evt) {
        try {
          const raw = typeof evt.data === "string" ? evt.data : ""
          const msg = JSON.parse(raw) as TerminalWsMessage

          switch (msg.type) {
            case "input":
              terminalService.sendInput(sessionId, msg.data)
              break
            case "resize":
              terminalService.resizeSession(sessionId, msg.cols, msg.rows)
              break
          }
        } catch {
          // ignore malformed messages
        }
      },

      onClose() {
        terminalService.detachSession(sessionId)
      },

      onError() {
        terminalService.detachSession(sessionId)
      },
    }
  }),
)

export default terminal
