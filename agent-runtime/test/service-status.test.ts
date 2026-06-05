import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { servicesRouter } from "../src/routers/services"
import {
  ManagedOpenCodeServer,
  createRuntimeServicesStatus,
} from "../src/runtime"

describe("runtime service status", () => {
  test("returns lazy external agent statuses", async () => {
    const app = new Hono()
    app.route("/", servicesRouter)

    const response = await app.request("/runtime/services/status")
    const body = await response.json() as {
      services: Array<{
        id: string
        label: string
        status: string
        implemented: boolean
        activeWorkspaceCount?: number
        pendingWorkspaceCount?: number
      }>
    }

    expect(response.status).toBe(200)
    expect(body.services).toContainEqual(expect.objectContaining({
      id: "opencode",
      label: "OpenCode",
      status: "idle",
      implemented: true,
      activeWorkspaceCount: 0,
      pendingWorkspaceCount: 0,
    }))
    expect(body.services).toContainEqual(expect.objectContaining({
      id: "codex",
      label: "Codex",
      status: "not_integrated",
      implemented: false,
    }))
    expect(body.services).toContainEqual(expect.objectContaining({
      id: "claude-code",
      label: "Claude Code",
      status: "idle",
      implemented: true,
    }))
  })

  test("summarizes OpenCode managed server lifecycle without exposing workspace paths", async () => {
    const server = new ManagedOpenCodeServer({
      resolveSdkWorkspaceOption: () => "cwd",
      allocatePort: async () => 4567,
      createSdkManaged: () => new Promise<never>(() => {}),
    })

    const ensurePromise = server.ensure("D:\\AgentHub\\Workspace")
    await new Promise((resolve) => setTimeout(resolve, 0))

    const starting = server.getStatus()
    expect(starting.status).toBe("starting")
    expect(starting.pendingWorkspaceCount).toBe(1)
    expect(JSON.stringify(starting)).not.toContain("D:\\AgentHub\\Workspace")

    const serviceStatus = createRuntimeServicesStatus(server)
    expect(serviceStatus.services.find((service) => service.id === "opencode")).toMatchObject({
      status: "starting",
      pendingWorkspaceCount: 1,
    })

    await server.closeAll()
    void ensurePromise.catch(() => {})
  })
})
