import { describe, expect, test } from "bun:test"
import { RealCodexClient } from "./codex-real-client"
import type { CodexSessionRequest } from "./codex-client"

type ThreadOptions = Record<string, unknown>

function fakeCodexSessionRequest(
  overrides: Partial<CodexSessionRequest> = {}
): CodexSessionRequest {
  return {
    runId: "run_1",
    conversationId: "conversation_1",
    agentId: "codex",
    scope: "conversation-visible",
    workspaceId: "workspace_1",
    workspaceRootPath: "D:\\workspace",
    ...overrides,
  }
}

describe("RealCodexClient", () => {
  test("passes model to startThread options", async () => {
    const startThreadOptions: ThreadOptions[] = []
    const client = new RealCodexClient({
      createSdk: () => ({
        startThread: (options) => {
          startThreadOptions.push(options ?? {})
          return { id: "thread_1" }
        },
        resumeThread: () => ({ id: "thread_existing" }),
      }),
    })

    await client.ensureSession(fakeCodexSessionRequest({ model: "gpt-5.1-codex" }))

    expect(startThreadOptions[0]).toMatchObject({
      workingDirectory: expect.any(String),
      sandboxMode: "workspace-write",
      networkAccessEnabled: true,
      model: "gpt-5.1-codex",
    })
  })

  test("passes model to resumeThread options", async () => {
    const resumeThreadCalls: Array<{ id: string; options: ThreadOptions }> = []
    const client = new RealCodexClient({
      createSdk: () => ({
        startThread: () => ({ id: "thread_1" }),
        resumeThread: (id, options) => {
          resumeThreadCalls.push({ id, options: options ?? {} })
          return { id }
        },
      }),
    })

    await client.ensureSession(fakeCodexSessionRequest({
      providerSessionId: "thread_existing",
      model: "gpt-5.1-codex",
    }))

    expect(resumeThreadCalls[0]).toEqual({
      id: "thread_existing",
      options: expect.objectContaining({
        workingDirectory: expect.any(String),
        sandboxMode: "workspace-write",
        networkAccessEnabled: true,
        model: "gpt-5.1-codex",
      }),
    })
  })

  test("omits model option when no model is configured", async () => {
    const startThreadOptions: ThreadOptions[] = []
    const client = new RealCodexClient({
      createSdk: () => ({
        startThread: (options) => {
          startThreadOptions.push(options ?? {})
          return { id: "thread_1" }
        },
        resumeThread: () => ({ id: "thread_existing" }),
      }),
    })

    await client.ensureSession(fakeCodexSessionRequest())

    expect(startThreadOptions[0]).toMatchObject({
      workingDirectory: expect.any(String),
      sandboxMode: "workspace-write",
      networkAccessEnabled: true,
    })
    expect(startThreadOptions[0]).not.toHaveProperty("model")
  })
})
