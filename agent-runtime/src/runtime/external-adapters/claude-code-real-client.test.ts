import { describe, expect, test } from "bun:test"
import { RealClaudeCodeClient, type ClaudeCodeQuery } from "./claude-code-real-client"
import type { ClaudeCodePromptRequest } from "./claude-code-client"

type QueryCall = {
  prompt: unknown
  options?: unknown
}

function fakeClaudeCodePromptRequest(
  overrides: Partial<ClaudeCodePromptRequest> & {
    model?: string
    permissionMode?: string
  } = {}
): ClaudeCodePromptRequest & {
  model?: string
  permissionMode?: string
} {
  return {
    session: {
      provider: "claude-code",
      agentId: "claude-code",
      scope: "conversation-visible",
      providerSessionId: "pending_run_1",
      conversationId: "conversation_1",
      workspaceId: "workspace_1",
      runId: "run_1",
    },
    prompt: {
      scope: "conversation-visible",
      content: "hello",
    },
    cwd: "D:\\workspace",
    signal: new AbortController().signal,
    ...overrides,
  }
}

function createFakeQuery(calls: QueryCall[]): ClaudeCodeQuery {
  return ((call: Parameters<ClaudeCodeQuery>[0]) => {
    calls.push(call)

    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        result: "done",
        session_id: "session_1",
      }
    })() as ReturnType<ClaudeCodeQuery>
  }) as ClaudeCodeQuery
}

async function consumeStream(client: RealClaudeCodeClient, request: ClaudeCodePromptRequest): Promise<void> {
  for await (const _event of client.streamPrompt(request)) {
    // Consume the stream so SDK query runs.
  }
}

describe("RealClaudeCodeClient", () => {
  test("passes configured model and permission mode to SDK query", async () => {
    const calls: QueryCall[] = []
    const client = new RealClaudeCodeClient({ query: createFakeQuery(calls) })

    await consumeStream(
      client,
      fakeClaudeCodePromptRequest({
        model: "claude-sonnet-4-5",
        permissionMode: "plan",
      })
    )

    expect(calls[0]).toMatchObject({
      options: {
        model: "claude-sonnet-4-5",
        permissionMode: "plan",
      },
    })
  })

  test("defaults permission mode and omits model when not configured", async () => {
    const calls: QueryCall[] = []
    const client = new RealClaudeCodeClient({ query: createFakeQuery(calls) })

    await consumeStream(client, fakeClaudeCodePromptRequest())

    expect(calls[0]).toMatchObject({
      options: {
        permissionMode: "default",
      },
    })
    expect(calls[0]?.options as Record<string, unknown>).not.toHaveProperty("model")
  })
})
