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
      id: "claude-code",
      label: "Claude Code",
      kind: "external-agent",
      status: "idle",
      implemented: true,
      checkedAt: "2026-06-06T00:00:00.000Z",
      details: { executableSource: "sdk-bundled" },
    })

    const snapshot = useServiceStatusStore.getState().snapshot
    expect(snapshot?.services.find((service) => service.id === "claude-code")).toMatchObject({
      label: "Claude Code",
      status: "idle",
      implemented: true,
      details: { executableSource: "sdk-bundled" },
    })
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
