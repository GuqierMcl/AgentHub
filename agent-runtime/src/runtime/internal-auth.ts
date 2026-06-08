import type { Context, Next } from "hono"

const RUNTIME_TOKEN_HEADER = "x-agenthub-runtime-token"

export function createRuntimeTokenAuthMiddleware(token?: string) {
  return async (c: Context, next: Next) => {
    if (!token) {
      await next()
      return
    }

    if (!c.req.path.startsWith("/runtime/")) {
      await next()
      return
    }

    if (c.req.header(RUNTIME_TOKEN_HEADER) !== token) {
      return c.json(
        {
          error: {
            code: "RUNTIME_AUTH_REQUIRED",
            message: "Agent Runtime internal token is required",
          },
        },
        401,
      )
    }

    await next()
  }
}
