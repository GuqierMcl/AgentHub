import { beforeEach, describe, expect, it } from "bun:test"

import { useServiceStatusStore } from "./service-status-store"

describe("service status store", () => {
  beforeEach(() => {
    useServiceStatusStore.setState({
      initialized: false,
      loading: false,
      snapshot: null,
    })
  })

  it("applies service status changes to the current snapshot", () => {
    useServiceStatusStore.getState().applyServiceStatusChange({
      id: "mcp-runtime",
      label: "MCP Runtime",
      kind: "runtime-capability",
      status: "idle",
      implemented: true,
      checkedAt: "2026-06-06T00:00:00.000Z",
      details: { trustedRecordCount: 1 },
    })

    const snapshot = useServiceStatusStore.getState().snapshot
    expect(snapshot?.services.find((service) => service.id === "mcp-runtime")).toMatchObject({
      label: "MCP Runtime",
      status: "idle",
      implemented: true,
      details: { trustedRecordCount: 1 },
    })
  })

  it("includes MCP runtime in fallback services", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error("runtime unavailable")
    }) as typeof fetch

    try {
      await useServiceStatusStore.getState().initialize()

      const snapshot = useServiceStatusStore.getState().snapshot
      expect(snapshot?.services.find((service) => service.id === "mcp-runtime")).toMatchObject({
        label: "MCP Runtime",
        kind: "runtime-capability",
        status: "error",
        implemented: true,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("does not install fallback statuses when initialization is aborted", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new DOMException("The operation was aborted.", "AbortError")
    }) as typeof fetch

    try {
      const controller = new AbortController()
      controller.abort()
      await useServiceStatusStore.getState().initialize(controller.signal)

      expect(useServiceStatusStore.getState()).toMatchObject({
        initialized: false,
        loading: false,
        snapshot: null,
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
