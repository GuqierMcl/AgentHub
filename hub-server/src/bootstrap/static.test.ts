import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { Hono } from "hono"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { attachStaticWeb } from "./static"

let publicDir = ""

beforeAll(async () => {
  publicDir = await mkdtemp(join(tmpdir(), "agenthub-static-"))
  await mkdir(join(publicDir, "assets"))
  await writeFile(join(publicDir, "index.html"), "<div id=\"root\"></div>")
  await writeFile(join(publicDir, "assets", "app.js"), "console.log('ok')")
})

afterAll(async () => {
  await rm(publicDir, { recursive: true, force: true })
})

function createApp(): Hono {
  const app = new Hono()
  app.get("/api/known", (c) => c.json({ ok: true }))
  attachStaticWeb(app, { publicDir })
  return app
}

describe("attachStaticWeb", () => {
  it("serves index.html for frontend routes", async () => {
    const response = await createApp().request("/settings")

    expect(response.status).toBe(200)
    expect(await response.text()).toContain("id=\"root\"")
  })

  it("serves static assets from the public directory", async () => {
    const response = await createApp().request("/assets/app.js")

    expect(response.status).toBe(200)
    expect(await response.text()).toContain("console.log('ok')")
  })

  it("does not let SPA fallback swallow unknown API routes", async () => {
    const response = await createApp().request("/api/missing")
    const body = await response.json() as { error: { code: string } }

    expect(response.status).toBe(404)
    expect(body.error.code).toBe("NOT_FOUND")
  })
})
