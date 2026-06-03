import { useMutation, useQueryClient } from "@tanstack/react-query"
import { workbenchQueryKeys } from "@/features/workbench/api/query-keys"
import { avatarOverridesApi } from "@/features/agents/api/avatar-overrides"
import type { AgentOverride } from "@/features/agents/types"

export function useSetAvatarOverride() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ agentId, override }: { agentId: string; override: AgentOverride }) =>
      avatarOverridesApi.set(agentId, override),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workbenchQueryKeys.avatarOverrides.all })
    },
  })
}

export function useUploadAvatarImage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ agentId, file }: { agentId: string; file: File }) =>
      avatarOverridesApi.uploadImage(agentId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workbenchQueryKeys.avatarOverrides.all })
    },
  })
}

export function useDeleteAvatarOverride() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (agentId: string) => avatarOverridesApi.delete(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workbenchQueryKeys.avatarOverrides.all })
    },
  })
}

export function useDeleteAvatarHistory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ agentId, historyId }: { agentId: string; historyId: string }) =>
      avatarOverridesApi.deleteHistory(agentId, historyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workbenchQueryKeys.avatarOverrides.all })
    },
  })
}

export function useRestoreAvatarHistory() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ agentId, historyId }: { agentId: string; historyId: string }) =>
      avatarOverridesApi.restoreHistory(agentId, historyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workbenchQueryKeys.avatarOverrides.all })
    },
  })
}
