import { useQuery } from "@tanstack/react-query"
import { workbenchQueryKeys } from "@/features/workbench/api/query-keys"
import { avatarOverridesApi } from "@/features/agents/api/avatar-overrides"
import type { AvatarOverridesManifest, AvatarLibraryItem } from "@/features/agents/types"

export function useAvatarOverrides() {
  return useQuery<AvatarOverridesManifest>({
    queryKey: workbenchQueryKeys.avatarOverrides.all,
    queryFn: () => avatarOverridesApi.list<AvatarOverridesManifest>(),
    staleTime: Infinity,
  })
}

export function useAgentOverride(agentId: string) {
  const { data } = useAvatarOverrides()
  return data?.agents[agentId] ?? null
}

export function useAvatarLibrary(agentId: string) {
  return useQuery<AvatarLibraryItem[]>({
    queryKey: [...workbenchQueryKeys.avatarOverrides.all, "library", agentId],
    queryFn: () => avatarOverridesApi.listLibrary(agentId),
    enabled: !!agentId,
  })
}
