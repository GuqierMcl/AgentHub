import { describe, expect, test } from "bun:test"

import {
  buildClaudeCodeExternalSettingsPayload,
  buildCodexExternalSettingsPayload,
  buildExternalSettingsUpdateInput,
  buildOpenCodeExternalSettingsPayload,
  filterExternalSettingsForProvider,
  resolveExternalSettingsProvider,
  shouldAutoLoadOpenCodeModelCatalog,
  shouldShowOpenCodeSelectedModelFallback,
} from "./external-agent-settings-state"
import type { AgentDetail } from "./types"

describe("external agent settings payload helpers", () => {
  test("builds OpenCode payload from SDK catalog model and conversation-only catalog inputs", () => {
    const payload = buildOpenCodeExternalSettingsPayload({
      executionAgent: "plan",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      rootPath: "D:\\Workspace\\Secret",
    })

    expect(payload).toEqual({
      provider: "opencode",
      executionAgent: "plan",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
    })
    expect(payload).not.toHaveProperty("rootPath")
  })

  test("omits OpenCode model when SDK default is selected", () => {
    expect(
      buildOpenCodeExternalSettingsPayload({
        executionAgent: "build",
        model: null,
      })
    ).toEqual({
      provider: "opencode",
      executionAgent: "build",
    })
  })

  test("wraps OpenCode model overrides with conversation id for save validation", () => {
    const settings = buildOpenCodeExternalSettingsPayload({
      executionAgent: "plan",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      rootPath: "D:\\Workspace\\Secret",
    })

    expect(buildExternalSettingsUpdateInput(settings, "conversation-1")).toEqual({
      settings,
      conversationId: "conversation-1",
    })
    expect(buildExternalSettingsUpdateInput(settings, "  ")).toBeNull()
  })

  test("keeps SDK-default and non-OpenCode external settings as direct save payloads", () => {
    expect(
      buildExternalSettingsUpdateInput({
        provider: "opencode",
        executionAgent: "build",
      })
    ).toEqual({
      provider: "opencode",
      executionAgent: "build",
    })
    expect(
      buildExternalSettingsUpdateInput({
        provider: "codex",
        model: "gpt-5-codex",
      })
    ).toEqual({
      provider: "codex",
      model: "gpt-5-codex",
    })
  })

  test("builds Claude Code payload with trimmed optional model and allowed permission mode", () => {
    expect(
      buildClaudeCodeExternalSettingsPayload({
        model: "  claude-sonnet-4  ",
        permissionMode: "acceptEdits",
      })
    ).toEqual({
      provider: "claude-code",
      model: "claude-sonnet-4",
      permissionMode: "acceptEdits",
    })
  })

  test("omits blank Claude Code model and rejects bypassPermissions", () => {
    expect(
      buildClaudeCodeExternalSettingsPayload({
        model: "   ",
        permissionMode: "default",
      })
    ).toEqual({
      provider: "claude-code",
      permissionMode: "default",
    })

    expect(() =>
      buildClaudeCodeExternalSettingsPayload({
        model: "",
        permissionMode: "bypassPermissions",
      })
    ).toThrow("不支持的 Claude Code 权限模式。")
  })

  test("builds Codex minimal payload and drops unsupported fields", () => {
    const payload = buildCodexExternalSettingsPayload({
      model: "  gpt-5-codex  ",
      sandbox: "danger-full-access",
      approval: "never",
      webSearch: true,
    })

    expect(payload).toEqual({
      provider: "codex",
      model: "gpt-5-codex",
    })
  })

  test("omits blank Codex model", () => {
    expect(buildCodexExternalSettingsPayload({ model: "" })).toEqual({
      provider: "codex",
    })
  })

  test("resolves provider from immutable adapter metadata before mutable settings", () => {
    const agent = {
      id: "opencode",
      external: {
        provider: "opencode",
      },
      externalSettings: {
        provider: "codex",
        model: "gpt-5-codex",
      },
    } as AgentDetail

    expect(resolveExternalSettingsProvider(agent)).toBe("opencode")
  })

  test("ignores settings that do not match the resolved provider", () => {
    expect(
      filterExternalSettingsForProvider("opencode", {
        provider: "codex",
        model: "gpt-5-codex",
      })
    ).toBeNull()
    expect(
      filterExternalSettingsForProvider("claude-code", {
        provider: "claude-code",
        permissionMode: "default",
      })
    ).toEqual({
      provider: "claude-code",
      permissionMode: "default",
    })
  })

  test("auto-loads OpenCode catalog once per selected conversation", () => {
    expect(
      shouldAutoLoadOpenCodeModelCatalog({
        provider: "opencode",
        selectedConversationId: "conversation-1",
        catalogLoading: false,
        catalogAutoLoadConversationId: null,
      })
    ).toBe(true)

    expect(
      shouldAutoLoadOpenCodeModelCatalog({
        provider: "opencode",
        selectedConversationId: "conversation-1",
        catalogLoading: false,
        catalogAutoLoadConversationId: "conversation-1",
      })
    ).toBe(false)
    expect(
      shouldAutoLoadOpenCodeModelCatalog({
        provider: "opencode",
        selectedConversationId: "conversation-1",
        catalogLoading: true,
        catalogAutoLoadConversationId: null,
      })
    ).toBe(false)
    expect(
      shouldAutoLoadOpenCodeModelCatalog({
        provider: "claude-code",
        selectedConversationId: "conversation-1",
        catalogLoading: false,
        catalogAutoLoadConversationId: null,
      })
    ).toBe(false)
    expect(
      shouldAutoLoadOpenCodeModelCatalog({
        provider: "opencode",
        selectedConversationId: "  ",
        catalogLoading: false,
        catalogAutoLoadConversationId: null,
      })
    ).toBe(false)
  })

  test("only shows an unavailable OpenCode selected model while catalog is loading", () => {
    const selectedModel = {
      providerID: "openai",
      modelID: "gpt-5",
    }
    const catalogModels = [
      {
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
      },
    ]

    expect(
      shouldShowOpenCodeSelectedModelFallback({
        selectedModel,
        catalogModels,
        catalogLoading: true,
      })
    ).toBe(true)
    expect(
      shouldShowOpenCodeSelectedModelFallback({
        selectedModel,
        catalogModels,
        catalogLoading: false,
      })
    ).toBe(false)
    expect(
      shouldShowOpenCodeSelectedModelFallback({
        selectedModel: catalogModels[0],
        catalogModels,
        catalogLoading: true,
      })
    ).toBe(false)
    expect(
      shouldShowOpenCodeSelectedModelFallback({
        selectedModel: null,
        catalogModels,
        catalogLoading: true,
      })
    ).toBe(false)
  })
})
