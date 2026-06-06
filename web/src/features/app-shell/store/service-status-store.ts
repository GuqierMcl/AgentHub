import { create } from "zustand"

import {
  fetchSystemServicesStatus,
  type SystemServiceStatusItem,
  type SystemServicesStatusResponse,
} from "../api/service-status"

type ServiceStatusStore = {
  initialized: boolean
  loading: boolean
  snapshot: SystemServicesStatusResponse | null
  initialize: (signal?: AbortSignal) => Promise<void>
  applyServiceStatusChange: (service: SystemServiceStatusItem) => void
}

export const FALLBACK_SERVICES: SystemServiceStatusItem[] = [
  createFallbackService("agent-runtime", "AgentRuntime", "runtime", "error", true),
  createFallbackService("opencode", "OpenCode", "external-agent", "error", true),
  createFallbackService("codex", "Codex", "external-agent", "not_integrated", false),
  createFallbackService("claude-code", "Claude Code", "external-agent", "not_integrated", false),
]

export const useServiceStatusStore = create<ServiceStatusStore>((set, get) => ({
  initialized: false,
  loading: false,
  snapshot: null,

  initialize: async (signal?: AbortSignal) => {
    const current = get()
    if (current.initialized || current.loading) return

    set({ loading: true })
    try {
      const snapshot = await fetchSystemServicesStatus(signal)
      set({
        initialized: true,
        loading: false,
        snapshot,
      })
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        set({ loading: false })
        return
      }

      set({
        initialized: true,
        loading: false,
        snapshot: createFallbackSnapshot(),
      })
    }
  },

  applyServiceStatusChange: (service) => {
    set((state) => {
      const current = state.snapshot ?? createFallbackSnapshot()
      const services = mergeService(current.services, service)
      return {
        initialized: true,
        snapshot: {
          checkedAt: service.checkedAt,
          services,
        },
      }
    })
  },
}))

function mergeService(
  services: SystemServiceStatusItem[],
  service: SystemServiceStatusItem
): SystemServiceStatusItem[] {
  const serviceIds = new Set(services.map((item) => item.id))
  if (!serviceIds.has(service.id)) {
    return [...services, service]
  }
  return services.map((item) => item.id === service.id ? service : item)
}

function createFallbackSnapshot(): SystemServicesStatusResponse {
  const checkedAt = new Date().toISOString()
  return {
    checkedAt,
    services: FALLBACK_SERVICES.map((service) => ({
      ...service,
      checkedAt,
    })),
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function createFallbackService(
  id: SystemServiceStatusItem["id"],
  label: string,
  kind: SystemServiceStatusItem["kind"],
  status: SystemServiceStatusItem["status"],
  implemented: boolean
): SystemServiceStatusItem {
  return {
    id,
    label,
    kind,
    status,
    implemented,
    checkedAt: new Date(0).toISOString(),
  }
}
