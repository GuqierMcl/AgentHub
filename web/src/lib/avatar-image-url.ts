export function buildAgentAvatarImageUrl(agentId: string, relativePath?: string): string {
  const baseUrl = `/api/avatar-overrides/${encodeURIComponent(agentId)}/file`
  if (!relativePath) {
    return baseUrl
  }

  return `${baseUrl}?v=${encodeURIComponent(relativePath)}`
}
