import { describe, expect, test } from "bun:test"
import type { ManagedOpenCodeServer } from "./opencode-server"
import { RealOpenCodeClient } from "./opencode-real-client"

function createConnection(client: unknown, directory = "D:\\workspace") {
  return {
    client,
    directory,
    mode: "managed-by-runtime",
    server: {
      url: "http://127.0.0.1:12345",
      close: () => {},
    },
    close: async () => {},
  }
}

function createServer(client: unknown, directory = "D:\\workspace"): ManagedOpenCodeServer {
  return {
    ensure: async () => createConnection(client, directory),
  } as unknown as ManagedOpenCodeServer
}

describe("RealOpenCodeClient", () => {
  test("passes SDK model override to session.prompt", async () => {
    const promptCalls: unknown[] = []
    const sdkClient = {
      session: {
        get: async () => ({ error: { name: "NotFoundError" } }),
        create: async () => ({
          data: {
            id: "session_1",
            title: "AgentHub test",
          },
        }),
        prompt: async (...args: unknown[]) => {
          promptCalls.push(args[0])
          return {
            data: {
              info: {
                id: "message_1",
              },
              parts: [{ type: "text", text: "done" }],
            },
          }
        },
      },
      event: {
        subscribe: async () => ({ stream: [] }),
      },
      provider: {
        list: async () => ({ data: { all: [] } }),
      },
    }
    const client = new RealOpenCodeClient({ server: createServer(sdkClient) })
    const session = await client.ensureSession({
      runId: "run_1",
      conversationId: "conversation_1",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_1",
      workspaceRootPath: "D:\\workspace",
    })

    for await (const _event of client.streamPrompt({
      session,
      prompt: {
        scope: "conversation-visible",
        content: "hello",
      },
      executionAgent: "plan",
      model: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
      },
      signal: new AbortController().signal,
    })) {
      // Consume the stream so session.prompt runs.
    }

    expect(promptCalls[0]).toMatchObject({
      sessionID: "session_1",
      directory: "D:\\workspace",
      agent: "plan",
      parts: [{ type: "text", text: "hello" }],
      model: {
        providerID: "anthropic",
        modelID: "claude-sonnet-4-5",
      },
    })
  })

  test("normalizes OpenCode SDK provider catalog", async () => {
    const sdkClient = {
      provider: {
        list: async () => ({
          data: {
            all: [
              {
                id: "anthropic",
                name: "Anthropic",
                models: {
                  "claude-sonnet-4-5": {
                    id: "claude-sonnet-4-5",
                    name: "Claude Sonnet 4.5",
                  },
                },
              },
            ],
            connected: ["anthropic"],
            default: { anthropic: "claude-sonnet-4-5" },
          },
        }),
      },
    }
    const client = new RealOpenCodeClient({ server: createServer(sdkClient) })

    await expect(client.listModels("D:\\workspace")).resolves.toEqual({
      provider: "opencode",
      models: [
        {
          providerID: "anthropic",
          providerName: "Anthropic",
          modelID: "claude-sonnet-4-5",
          modelName: "Claude Sonnet 4.5",
        },
      ],
      warnings: [],
    })
  })

  test("filters OpenCode SDK provider catalog to connected providers", async () => {
    const sdkClient = {
      provider: {
        list: async () => ({
          data: {
            all: [
              {
                id: "anthropic",
                name: "Anthropic",
                models: {
                  "claude-sonnet-4-5": {
                    id: "claude-sonnet-4-5",
                    name: "Claude Sonnet 4.5",
                  },
                },
              },
              {
                id: "openai",
                name: "OpenAI",
                models: {
                  "gpt-5": {
                    id: "gpt-5",
                    name: "GPT-5",
                  },
                },
              },
            ],
            connected: ["anthropic"],
            default: { anthropic: "claude-sonnet-4-5" },
          },
        }),
      },
    }
    const client = new RealOpenCodeClient({ server: createServer(sdkClient) })

    await expect(client.listModels("D:\\workspace")).resolves.toEqual({
      provider: "opencode",
      models: [
        {
          providerID: "anthropic",
          providerName: "Anthropic",
          modelID: "claude-sonnet-4-5",
          modelName: "Claude Sonnet 4.5",
        },
      ],
      warnings: [],
    })
  })
})
