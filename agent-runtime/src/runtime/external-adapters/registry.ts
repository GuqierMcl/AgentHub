import type { ExternalAgentAdapter, ExternalAdapterRegistry } from "./types"
import { OpenCodeAdapter } from "./opencode-adapter"

export class DefaultExternalAdapterRegistry implements ExternalAdapterRegistry {
  private adapters = new Map<string, ExternalAgentAdapter>()

  constructor(adapters: ExternalAgentAdapter[] = [new OpenCodeAdapter()]) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.provider, adapter)
    }
  }

  getAdapter(provider: string): ExternalAgentAdapter | null {
    return this.adapters.get(provider) ?? null
  }
}
