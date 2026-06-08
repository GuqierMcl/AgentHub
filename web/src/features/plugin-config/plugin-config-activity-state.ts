import type { CapabilityScope } from "./types"

export type MountedPluginConfigQuery = {
  queryKey: string
  scope: CapabilityScope
  conversationId?: string
}

export function buildPluginConfigQueryKey(
  scope: CapabilityScope,
  conversationId?: string,
): string {
  return scope === "global"
    ? "global"
    : `workspace:${conversationId ?? ""}`
}

export function createMountedPluginConfigQuery(
  scope: CapabilityScope,
  conversationId?: string,
): MountedPluginConfigQuery {
  return {
    queryKey: buildPluginConfigQueryKey(scope, conversationId),
    scope,
    conversationId,
  }
}

export function appendMountedPluginConfigQuery(
  mountedQueries: readonly MountedPluginConfigQuery[],
  nextQuery: MountedPluginConfigQuery,
): MountedPluginConfigQuery[] {
  return mountedQueries.some((query) => query.queryKey === nextQuery.queryKey)
    ? [...mountedQueries]
    : [...mountedQueries, nextQuery]
}
