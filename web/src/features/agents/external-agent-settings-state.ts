import type {
  AgentDetail,
  ClaudeCodePermissionMode,
  ExternalAgentSettings,
  ExternalAgentSettingsUpdateInput,
  OpenCodeExecutionAgent,
  OpenCodeModelRef,
} from "./types"

export type ExternalProvider = ExternalAgentSettings["provider"]

const CLAUDE_CODE_PERMISSION_MODES = new Set<string>([
  "default",
  "acceptEdits",
  "plan",
  "dontAsk",
  "auto",
])

const EXTERNAL_PROVIDERS = new Set<string>(["opencode", "claude-code", "codex"])

type OpenCodeSettingsFormState = {
  executionAgent: OpenCodeExecutionAgent
  model?: OpenCodeModelRef | null
  [key: string]: unknown
}

type ClaudeCodeSettingsFormState = {
  model?: string
  permissionMode: string
  [key: string]: unknown
}

type CodexSettingsFormState = {
  model?: string
  [key: string]: unknown
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function isExternalProvider(value: unknown): value is ExternalProvider {
  return typeof value === "string" && EXTERNAL_PROVIDERS.has(value)
}

export function resolveExternalSettingsProvider(
  agent: Pick<AgentDetail, "external" | "id">
): ExternalProvider | null {
  const provider = agent.external?.provider ?? agent.id
  return isExternalProvider(provider) ? provider : null
}

export function filterExternalSettingsForProvider<P extends ExternalProvider>(
  provider: P,
  settings: ExternalAgentSettings | null | undefined
): Extract<ExternalAgentSettings, { provider: P }> | null {
  return settings?.provider === provider
    ? (settings as Extract<ExternalAgentSettings, { provider: P }>)
    : null
}

export function buildOpenCodeExternalSettingsPayload(
  state: OpenCodeSettingsFormState
): Extract<ExternalAgentSettings, { provider: "opencode" }> {
  return {
    provider: "opencode",
    executionAgent: state.executionAgent,
    ...(state.model
      ? {
          model: {
            providerID: state.model.providerID,
            modelID: state.model.modelID,
          },
        }
      : {}),
  }
}

export function buildExternalSettingsUpdateInput(
  settings: ExternalAgentSettings,
  conversationId?: string
): ExternalAgentSettingsUpdateInput | null {
  if (settings.provider === "opencode") {
    if (!settings.model) {
      return {
        provider: "opencode",
        ...(settings.executionAgent
          ? { executionAgent: settings.executionAgent }
          : {}),
      }
    }

    const trimmedConversationId = optionalTrimmed(conversationId)
    if (!trimmedConversationId) {
      return null
    }
    return {
      settings: {
        provider: "opencode",
        model: settings.model,
        ...(settings.executionAgent
          ? { executionAgent: settings.executionAgent }
          : {}),
      },
      conversationId: trimmedConversationId,
    }
  }

  return settings
}

export function buildClaudeCodeExternalSettingsPayload(
  state: ClaudeCodeSettingsFormState
): Extract<ExternalAgentSettings, { provider: "claude-code" }> {
  if (!CLAUDE_CODE_PERMISSION_MODES.has(state.permissionMode)) {
    throw new Error("不支持的 Claude Code 权限模式。")
  }

  const model = optionalTrimmed(state.model)
  return {
    provider: "claude-code",
    ...(model ? { model } : {}),
    permissionMode: state.permissionMode as ClaudeCodePermissionMode,
  }
}

export function buildCodexExternalSettingsPayload(
  state: CodexSettingsFormState
): Extract<ExternalAgentSettings, { provider: "codex" }> {
  const model = optionalTrimmed(state.model)
  return {
    provider: "codex",
    ...(model ? { model } : {}),
  }
}
