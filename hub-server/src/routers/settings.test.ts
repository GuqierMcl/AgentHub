import { describe, expect, it } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import settingsRouter from "./settings"
import { errorHandler } from "../lib/errors"
import type { RuntimeClient } from "../lib/runtime"

function createApp(runtimeClient: Partial<RuntimeClient>): Hono {
  const app = new Hono()
  app.onError(errorHandler)
  app.use("*", async (c: Context, next: Next) => {
    c.set("runtimeClient", runtimeClient as RuntimeClient)
    await next()
  })
  app.route("/", settingsRouter)
  return app
}

describe("settings router model settings proxy", () => {
  it("proxies system default model settings to Agent Runtime", async () => {
    const calls: Array<[string, string, unknown]> = []
    const runtimeResponse = {
      status: "configured",
      systemDefaultModel: { providerId: "openai", modelId: "gpt-test" },
    }
    const app = createApp({
      forward: async (method: string, path: string, body?: unknown) => {
        calls.push([method, path, body])
        return { status: 200, data: runtimeResponse }
      },
    })

    expect((await app.request("/api/settings/model")).status).toBe(200)

    const putResponse = await app.request("/api/settings/model", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "openai", modelId: "gpt-test" }),
    })
    expect(putResponse.status).toBe(200)
    expect(await putResponse.json()).toEqual(runtimeResponse)

    const deleteResponse = await app.request("/api/settings/model", {
      method: "DELETE",
    })
    expect(deleteResponse.status).toBe(200)

    expect(calls).toEqual([
      ["GET", "/runtime/settings/model", undefined],
      ["PUT", "/runtime/settings/model", { providerId: "openai", modelId: "gpt-test" }],
      ["DELETE", "/runtime/settings/model", undefined],
    ])
  })
})
