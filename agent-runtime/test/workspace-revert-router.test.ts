import { describe, expect, test } from "bun:test"
import { Hono, type Context, type Next } from "hono"
import workspaceRevert from "../src/routers/workspace-revert"
import type { WorkspaceRevertService } from "../src/runtime"

function createApp(service: Partial<WorkspaceRevertService>): Hono {
  const app = new Hono()
  app.use("*", async (c: Context, next: Next) => {
    c.set("workspaceRevertService", service as WorkspaceRevertService)
    await next()
  })
  app.route("/", workspaceRevert)
  return app
}

const validBody = {
  workspace: {
    workspaceId: "workspace_1",
    backendType: "local",
    rootPath: "D:\\workspace",
  },
  source: {
    artifactId: "art_1",
    changeSetId: "wcs_1",
    runId: "run_1",
    patchText: "diff --git a/a.txt b/a.txt\n",
    patchTruncated: false,
    baselineDirty: false,
    runOnlyReliable: true,
    changedFiles: [{
      path: "a.txt",
      origin: "new-since-baseline",
    }],
  },
}

describe("workspace revert router", () => {
  test("forwards preview requests to the workspace revert service", async () => {
    const calls: unknown[] = []
    const app = createApp({
      preview: async (request) => {
        calls.push(request)
        return {
          status: "available",
          canApply: true,
          files: [{ path: "a.txt", action: "modify" }],
          warnings: [],
          source: {
            artifactId: "art_1",
            changeSetId: "wcs_1",
            runId: "run_1",
            patchDirection: "reverse-applied",
          },
        }
      },
    })

    const response = await app.request("/runtime/workspace/revert/preview", {
      method: "POST",
      body: JSON.stringify(validBody),
      headers: { "Content-Type": "application/json" },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: "available", canApply: true })
    expect(calls).toHaveLength(1)
  })

  test("rejects invalid revert input", async () => {
    const app = createApp({})

    const response = await app.request("/runtime/workspace/revert/apply", {
      method: "POST",
      body: JSON.stringify({ workspace: {}, source: {} }),
      headers: { "Content-Type": "application/json" },
    })
    const body = await response.json() as { error?: { code?: string } }

    expect(response.status).toBe(400)
    expect(body.error?.code).toBe("WORKSPACE_REVERT_INVALID_INPUT")
  })
})
