import { describe, expect, it } from "bun:test"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { AppError } from "../lib/errors"
import type { RuntimeClient } from "../lib/runtime"
import { HubEventBus, type HubGlobalEventEnvelope } from "./hub-event-bus.service"
import {
  fetchSystemServicesStatusSnapshot,
  ServiceStatusMonitor,
  type ServiceStatus,
} from "./service-status.service"

describe("service status snapshot", () => {
  it("returns degraded statuses when Agent Runtime is unavailable", async () => {
    const client = {
      forward: async () => {
        throw new AppError(
          503 as ContentfulStatusCode,
          "RUNTIME_NOT_READY",
          "Agent Runtime is not available"
        )
      },
    } as Partial<RuntimeClient> as RuntimeClient

    const snapshot = await fetchSystemServicesStatusSnapshot(client)

    expect(snapshot.services.find((service) => service.id === "agent-runtime")).toMatchObject({
      status: "error",
      implemented: true,
    })
    expect(snapshot.services.find((service) => service.id === "opencode")).toMatchObject({
      status: "error",
      implemented: true,
    })
    expect(snapshot.services.find((service) => service.id === "codex")).toMatchObject({
      status: "error",
      implemented: true,
    })
    expect(snapshot.services.find((service) => service.id === "claude-code")).toMatchObject({
      status: "error",
      implemented: true,
    })
    expect(snapshot.services.find((service) => service.id === "capability-discovery")).toMatchObject({
      status: "error",
      implemented: true,
      details: {
        reason: "runtime-unavailable",
      },
    })
  })

  it("passes through Runtime capability discovery status", async () => {
    const client = {
      forward: async (method: string, path: string) => {
        if (path === "/health") {
          return { status: 200, data: { status: "ok" } }
        }
        if (path === "/runtime/services/status") {
          return {
            status: 200,
            data: {
              checkedAt: "2026-06-07T00:00:00.000Z",
              services: [
                {
                  id: "opencode",
                  label: "OpenCode",
                  kind: "external-agent",
                  status: "idle",
                  implemented: true,
                  checkedAt: "2026-06-07T00:00:00.000Z",
                },
                {
                  id: "codex",
                  label: "Codex",
                  kind: "external-agent",
                  status: "idle",
                  implemented: true,
                  checkedAt: "2026-06-07T00:00:00.000Z",
                },
                {
                  id: "claude-code",
                  label: "Claude Code",
                  kind: "external-agent",
                  status: "idle",
                  implemented: true,
                  checkedAt: "2026-06-07T00:00:00.000Z",
                },
                {
                  id: "capability-discovery",
                  label: "Capability Discovery",
                  kind: "runtime-capability",
                  status: "refreshing",
                  implemented: true,
                  checkedAt: "2026-06-07T00:00:00.000Z",
                  details: {
                    cacheEntryCount: 2,
                    latestRefreshAt: "2026-06-07T00:00:00.000Z",
                  },
                },
              ],
            },
          }
        }
        throw new Error(`unexpected ${method} ${path}`)
      },
    } as Partial<RuntimeClient> as RuntimeClient

    const snapshot = await fetchSystemServicesStatusSnapshot(client)

    expect(snapshot.services.find((service) => service.id === "capability-discovery")).toMatchObject({
      id: "capability-discovery",
      label: "Capability Discovery",
      kind: "runtime-capability",
      status: "refreshing",
      implemented: true,
      details: expect.objectContaining({
        cacheEntryCount: 2,
        latestRefreshAt: "2026-06-07T00:00:00.000Z",
      }),
    })
  })
})

describe("ServiceStatusMonitor", () => {
  it("seeds the first snapshot and only publishes when status changes", async () => {
    let openCodeStatus: ServiceStatus = "idle"
    const bus = new HubEventBus()
    const events: HubGlobalEventEnvelope[] = []
    bus.subscribe((event) => events.push(event))

    const monitor = new ServiceStatusMonitor(
      createRuntimeClient(() => openCodeStatus),
      bus
    )

    await monitor.checkOnce()
    await monitor.checkOnce()
    expect(events).toHaveLength(0)

    openCodeStatus = "running"
    await monitor.checkOnce()

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: "service.status.changed",
      data: {
        previousStatus: "idle",
        service: {
          id: "opencode",
          status: "running",
          implemented: true,
        },
      },
    })
  })

  it("publishes degraded status changes after Runtime becomes unavailable", async () => {
    let unavailable = false
    const bus = new HubEventBus()
    const events: HubGlobalEventEnvelope[] = []
    bus.subscribe((event) => events.push(event))

    const client = {
      forward: async (method: string, path: string) => {
        if (unavailable) {
          throw new AppError(
            503 as ContentfulStatusCode,
            "RUNTIME_NOT_READY",
            "Agent Runtime is not available"
          )
        }
        return createRuntimeResponse(method, path, "idle")
      },
    } as Partial<RuntimeClient> as RuntimeClient
    const monitor = new ServiceStatusMonitor(client, bus)

    await monitor.checkOnce()
    unavailable = true
    await monitor.checkOnce()

    expect(events.map((event) => ({
      type: event.type,
      previousStatus: event.data.previousStatus,
      serviceId: getServiceId(event),
      status: getServiceStatus(event),
    }))).toEqual([
      {
        type: "service.status.changed",
        previousStatus: "running",
        serviceId: "agent-runtime",
        status: "error",
      },
      {
        type: "service.status.changed",
        previousStatus: "idle",
        serviceId: "opencode",
        status: "error",
      },
      {
        type: "service.status.changed",
        previousStatus: "idle",
        serviceId: "codex",
        status: "error",
      },
      {
        type: "service.status.changed",
        previousStatus: "idle",
        serviceId: "claude-code",
        status: "error",
      },
      {
        type: "service.status.changed",
        previousStatus: "idle",
        serviceId: "capability-discovery",
        status: "error",
      },
    ])
  })
})

function createRuntimeClient(
  getOpenCodeStatus: () => ServiceStatus
): RuntimeClient {
  return {
    forward: async (method: string, path: string) =>
      createRuntimeResponse(method, path, getOpenCodeStatus()),
  } as Partial<RuntimeClient> as RuntimeClient
}

function createRuntimeResponse(
  _method: string,
  path: string,
  openCodeStatus: ServiceStatus
): { status: number; data: unknown } {
  if (path === "/health") {
    return { status: 200, data: { status: "ok" } }
  }
  if (path === "/runtime/services/status") {
    return {
      status: 200,
      data: {
        checkedAt: "2026-06-03T00:00:00.000Z",
        services: [
          {
            id: "opencode",
            label: "OpenCode",
            kind: "external-agent",
            status: openCodeStatus,
            implemented: true,
            checkedAt: "2026-06-03T00:00:00.000Z",
          },
          {
            id: "codex",
            label: "Codex",
            kind: "external-agent",
            status: "idle",
            implemented: true,
            checkedAt: "2026-06-03T00:00:00.000Z",
          },
          {
            id: "claude-code",
            label: "Claude Code",
            kind: "external-agent",
            status: "idle",
            implemented: true,
            checkedAt: "2026-06-03T00:00:00.000Z",
          },
          {
            id: "capability-discovery",
            label: "Capability Discovery",
            kind: "runtime-capability",
            status: "idle",
            implemented: true,
            checkedAt: "2026-06-03T00:00:00.000Z",
            details: {
              cacheEntryCount: 0,
            },
          },
        ],
      },
    }
  }
  throw new Error(`unexpected path ${path}`)
}

function getServiceId(event: HubGlobalEventEnvelope): string | undefined {
  const service = event.data.service
  return service && typeof service === "object" && "id" in service
    ? String(service.id)
    : undefined
}

function getServiceStatus(event: HubGlobalEventEnvelope): string | undefined {
  const service = event.data.service
  return service && typeof service === "object" && "status" in service
    ? String(service.status)
    : undefined
}
