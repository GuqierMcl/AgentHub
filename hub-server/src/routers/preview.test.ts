import { afterEach, describe, expect, it } from "bun:test"
import { Hono, type Context, type Next } from "hono"

import { errorHandler } from "../lib/errors"
import previewRouter from "./preview"

function createApp(): Hono {
  const app = new Hono()
  app.onError(errorHandler)
  app.use("*", async (_c: Context, next: Next) => {
    await next()
  })
  app.route("/", previewRouter)
  return app
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("preview router", () => {
  it("injects navigation interception for preview links", async () => {
    globalThis.fetch = (async () =>
      new Response(
        [
          "<!doctype html>",
          "<html>",
          "<head><title>Example</title></head>",
          '<body><a href="/next">Next</a></body>',
          "</html>",
        ].join(""),
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
          status: 200,
        }
      )) as unknown as typeof fetch

    const response = await createApp().request(
      "/api/preview/proxy?url=https%3A%2F%2Fexample.com"
    )
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain("PREVIEW_NAVIGATE")
    expect(html).toContain("window.parent.postMessage")
    expect(html).toContain("closest('a')")
    expect(html).toContain("</script>")
    expect(html).not.toContain("<\\/script>")
  })
})
