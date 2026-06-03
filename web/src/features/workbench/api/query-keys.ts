export const workbenchQueryKeys = {
  conversations: {
    all: ["conversations"] as const,
    list: (status: "active" | "archived") =>
      ["conversations", status] as const,
    detail: (conversationId: string) =>
      ["conversation", conversationId] as const,
    messages: (conversationId: string) =>
      ["conversation", conversationId, "messages"] as const,
  },
  agents: {
    all: ["runtime-agents"] as const,
    primaryEnabled: ["runtime-agents", "primary", "enabled"] as const,
  },
  avatarOverrides: {
    all: ["avatar-overrides"] as const,
  },
}
