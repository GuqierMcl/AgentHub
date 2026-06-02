import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import {
  ExternalAdapterError,
  ManagedOpenCodeServer,
  RealOpenCodeClient,
  extractAssistantText,
  type OpenCodeApiClient,
  type OpenCodeWorkspaceConnection,
} from "../src/runtime"

async function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "agent-runtime-real-opencode-"))
}

function response<T>(data: T): { data: T; error: undefined } {
  return { data, error: undefined }
}

function errorResponse(error: unknown): { data: undefined; error: unknown } {
  return { data: undefined, error }
}

function createHealthyClient(workspaceRoot: string, overrides: Partial<{
  sessionGet: (id: string) => Promise<unknown>
  sessionCreate: (title?: string) => Promise<unknown>
  sessionPrompt: (text: string, signal?: AbortSignal) => Promise<unknown>
  sessionAbort: (id: string) => Promise<unknown>
  providerList: () => Promise<unknown>
  projectWorktree: string
  pathDirectory: string
  pathWorktree: string
}> = {}): OpenCodeApiClient {
  return {
    project: {
      current: async () => response({
        id: "project_test",
        worktree: overrides.projectWorktree ?? workspaceRoot,
        time: { created: Date.now() },
      }),
    },
    path: {
      get: async () => response({
        state: join(workspaceRoot, ".opencode"),
        config: join(workspaceRoot, "opencode.json"),
        worktree: overrides.pathWorktree ?? workspaceRoot,
        directory: overrides.pathDirectory ?? workspaceRoot,
      }),
    },
    session: {
      get: async (options: { path: { id: string } }) => {
        if (overrides.sessionGet) {
          return overrides.sessionGet(options.path.id)
        }
        return response(createSession(options.path.id, "Existing"))
      },
      create: async (options?: { body?: { title?: string } }) => {
        if (overrides.sessionCreate) {
          return overrides.sessionCreate(options?.body?.title)
        }
        return response(createSession("session_created", options?.body?.title ?? "Untitled"))
      },
      prompt: async (options: {
        body?: { parts?: Array<{ text?: string }> }
        signal?: AbortSignal
      }) => {
        const text = options.body?.parts?.[0]?.text ?? ""
        if (overrides.sessionPrompt) {
          return overrides.sessionPrompt(text, options.signal)
        }
        return response({
          info: {
            id: "message_assistant",
            role: "assistant",
            sessionID: "session_created",
          },
          parts: [{
            type: "text",
            text: `OpenCode says: ${text}`,
          }],
        })
      },
      abort: async (options: { path: { id: string } }) => {
        if (overrides.sessionAbort) {
          return overrides.sessionAbort(options.path.id)
        }
        return response(true)
      },
    },
    provider: {
      list: async () => {
        if (overrides.providerList) {
          return overrides.providerList()
        }
        return response({
          all: [{
            id: "anthropic",
            name: "Anthropic",
            env: [],
            models: {
              "claude-sonnet-4": {
                id: "claude-sonnet-4",
                name: "Claude Sonnet 4",
              },
            },
          }],
          default: {},
          connected: [],
        })
      },
    },
  } as unknown as OpenCodeApiClient
}

function createSession(id: string, title: string): unknown {
  return {
    id,
    projectID: "project_test",
    directory: "workspace",
    title,
    version: "test",
    time: {
      created: Date.now(),
      updated: Date.now(),
    },
  }
}

class FakeOpenCodeProcess extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false

  kill(): boolean {
    this.killed = true
    this.emit("exit", null, "SIGTERM")
    return true
  }
}

function createConnection(workspaceRoot: string, client: OpenCodeApiClient): OpenCodeWorkspaceConnection {
  return {
    mode: "managed-by-runtime",
    client,
    directory: workspaceRoot,
    server: {
      url: "http://127.0.0.1:4096",
      close() {},
    },
    async close() {},
  }
}

describe("ManagedOpenCodeServer", () => {
  test("uses SDK managed startup when a workspace option is available", async () => {
    const workspaceRoot = await createWorkspace()
    const client = createHealthyClient(workspaceRoot)
    let sdkOptions: Record<string, unknown> | undefined
    let closed = false
    const server = new ManagedOpenCodeServer({
      allocatePort: async () => 4111,
      resolveSdkWorkspaceOption: () => "cwd",
      createSdkManaged: async (options) => {
        sdkOptions = options
        return {
          client,
          server: {
            url: "http://127.0.0.1:4111",
            close() {
              closed = true
            },
          },
        }
      },
    })

    const connection = await server.ensure(workspaceRoot)

    expect(connection.server.url).toBe("http://127.0.0.1:4111")
    expect(sdkOptions?.cwd).toBe(workspaceRoot)
    expect(sdkOptions?.hostname).toBe("127.0.0.1")

    await connection.close()
    expect(closed).toBe(true)
  })

  test("falls back to CLI with workspace cwd when SDK has no workspace option", async () => {
    const workspaceRoot = await createWorkspace()
    const fakeProcess = new FakeOpenCodeProcess()
    let launched: { command: string; args: string[]; cwd: string } | undefined
    const server = new ManagedOpenCodeServer({
      allocatePort: async () => 4222,
      resolveSdkWorkspaceOption: () => null,
      launchProcess: (command, args, options) => {
        launched = { command, args, cwd: options.cwd }
        queueMicrotask(() => {
          fakeProcess.stdout.write("opencode server listening on http://127.0.0.1:4222\n")
        })
        return fakeProcess as any
      },
      createClient: () => createHealthyClient(workspaceRoot),
    })

    const connection = await server.ensure(workspaceRoot)

    expect(launched).toEqual({
      command: "opencode",
      args: ["serve", "--hostname=127.0.0.1", "--port=4222"],
      cwd: workspaceRoot,
    })
    expect(connection.server.url).toBe("http://127.0.0.1:4222")

    await connection.close()
    expect(fakeProcess.killed).toBe(true)
  })

  test("returns workspace mismatch when OpenCode reports another project path", async () => {
    const workspaceRoot = await createWorkspace()
    const otherWorkspace = await createWorkspace()
    const server = new ManagedOpenCodeServer({
      allocatePort: async () => 4333,
      resolveSdkWorkspaceOption: () => "cwd",
      createSdkManaged: async () => ({
        client: createHealthyClient(workspaceRoot, {
          projectWorktree: otherWorkspace,
        }),
        server: {
          url: "http://127.0.0.1:4333",
          close() {},
        },
      }),
    })

    await expect(server.ensure(workspaceRoot)).rejects.toMatchObject({
      code: "ADAPTER_WORKSPACE_MISMATCH",
    })
  })

  test("times out unhealthy CLI startup and kills the process", async () => {
    const workspaceRoot = await createWorkspace()
    const fakeProcess = new FakeOpenCodeProcess()
    const server = new ManagedOpenCodeServer({
      startupTimeoutMs: 5,
      allocatePort: async () => 4444,
      resolveSdkWorkspaceOption: () => null,
      launchProcess: () => fakeProcess as any,
      createClient: () => createHealthyClient(workspaceRoot),
    })

    await expect(server.ensure(workspaceRoot)).rejects.toMatchObject({
      code: "ADAPTER_SERVER_UNHEALTHY",
    })
    expect(fakeProcess.killed).toBe(true)
  })
})

describe("RealOpenCodeClient", () => {
  test("reuses a hinted session when OpenCode can load it", async () => {
    const workspaceRoot = await createWorkspace()
    let createCalls = 0
    const apiClient = createHealthyClient(workspaceRoot, {
      sessionCreate: async () => {
        createCalls += 1
        return response(createSession("unexpected_new_session", "Unexpected"))
      },
    })
    const client = new RealOpenCodeClient({
      server: {
        ensure: async () => createConnection(workspaceRoot, apiClient),
      } as unknown as ManagedOpenCodeServer,
    })

    const link = await client.ensureSession({
      runId: "run_reuse",
      conversationId: "conv_reuse",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_reuse",
      workspaceRootPath: workspaceRoot,
      providerSessionId: "session_existing",
    })

    expect(link.providerSessionId).toBe("session_existing")
    expect(createCalls).toBe(0)
  })

  test("creates a replacement session when the hinted provider session is missing", async () => {
    const workspaceRoot = await createWorkspace()
    let createdTitle: string | undefined
    const apiClient = createHealthyClient(workspaceRoot, {
      sessionGet: async () => errorResponse({
        name: "NotFoundError",
        data: { message: "not found" },
      }),
      sessionCreate: async (title) => {
        createdTitle = title
        return response(createSession("session_replacement", title ?? ""))
      },
    })
    const client = new RealOpenCodeClient({
      server: {
        ensure: async () => createConnection(workspaceRoot, apiClient),
      } as unknown as ManagedOpenCodeServer,
    })

    const link = await client.ensureSession({
      runId: "run_replace",
      conversationId: "conv_replace",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_replace",
      workspaceRootPath: workspaceRoot,
      providerSessionId: "session_missing",
    })

    expect(link.providerSessionId).toBe("session_replacement")
    expect(createdTitle).toBe("AgentHub: conv_replace")
  })

  test("extracts prompt text and yields visible message events", async () => {
    const workspaceRoot = await createWorkspace()
    const apiClient = createHealthyClient(workspaceRoot, {
      sessionPrompt: async () => response({
        info: {
          id: "message_assistant",
          role: "assistant",
          sessionID: "session_prompt",
          providerID: "anthropic",
          modelID: "claude-sonnet-4",
        },
        parts: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
          { type: "text", text: " ignored", ignored: true },
        ],
      }),
    })
    const client = new RealOpenCodeClient({
      server: {
        ensure: async () => createConnection(workspaceRoot, apiClient),
      } as unknown as ManagedOpenCodeServer,
    })
    const session = await client.ensureSession({
      runId: "run_prompt",
      conversationId: "conv_prompt",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_prompt",
      workspaceRootPath: workspaceRoot,
    })

    const events = []
    for await (const event of client.streamPrompt({
      session,
      prompt: {
        scope: "conversation-visible",
        content: "Say hello",
      },
      signal: new AbortController().signal,
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: "message.delta", delta: "Hello world" },
      {
        type: "message.completed",
        content: "Hello world",
        externalModel: {
          provider: "opencode",
          providerId: "anthropic",
          modelId: "claude-sonnet-4",
          providerName: "Anthropic",
          modelName: "Claude Sonnet 4",
        },
      },
    ])
    expect(extractAssistantText([{ type: "text", text: "a" } as any])).toBe("a")
  })

  test("keeps prompt output when OpenCode provider catalog cannot resolve model names", async () => {
    const workspaceRoot = await createWorkspace()
    const apiClient = createHealthyClient(workspaceRoot, {
      providerList: async () => {
        throw new Error("provider catalog unavailable")
      },
      sessionPrompt: async () => response({
        info: {
          id: "message_assistant",
          role: "assistant",
          sessionID: "session_prompt",
          providerID: "anthropic",
          modelID: "claude-sonnet-4",
        },
        parts: [
          { type: "text", text: "Hello without names" },
        ],
      }),
    })
    const client = new RealOpenCodeClient({
      server: {
        ensure: async () => createConnection(workspaceRoot, apiClient),
      } as unknown as ManagedOpenCodeServer,
    })
    const session = await client.ensureSession({
      runId: "run_prompt_catalog_error",
      conversationId: "conv_prompt_catalog_error",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_prompt_catalog_error",
      workspaceRootPath: workspaceRoot,
    })

    const events = []
    for await (const event of client.streamPrompt({
      session,
      prompt: {
        scope: "conversation-visible",
        content: "Say hello",
      },
      signal: new AbortController().signal,
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: "message.delta", delta: "Hello without names" },
      {
        type: "message.completed",
        content: "Hello without names",
        externalModel: {
          provider: "opencode",
          providerId: "anthropic",
          modelId: "claude-sonnet-4",
        },
      },
    ])
  })

  test("aborts the OpenCode session when the run signal is cancelled", async () => {
    const workspaceRoot = await createWorkspace()
    let abortCalledWith: string | undefined
    let resolvePrompt: ((value: unknown) => void) | undefined
    const apiClient = createHealthyClient(workspaceRoot, {
      sessionPrompt: async () => new Promise((resolve) => {
        resolvePrompt = resolve
      }),
      sessionAbort: async (id) => {
        abortCalledWith = id
        resolvePrompt?.(response({
          info: {
            id: "message_assistant",
            role: "assistant",
            sessionID: id,
          },
          parts: [{ type: "text", text: "late" }],
        }))
        return response(true)
      },
    })
    const client = new RealOpenCodeClient({
      server: {
        ensure: async () => createConnection(workspaceRoot, apiClient),
      } as unknown as ManagedOpenCodeServer,
    })
    const session = await client.ensureSession({
      runId: "run_abort",
      conversationId: "conv_abort",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_abort",
      workspaceRootPath: workspaceRoot,
    })
    const controller = new AbortController()
    const iterator = client.streamPrompt({
      session,
      prompt: {
        scope: "conversation-visible",
        content: "Wait",
      },
      signal: controller.signal,
    })[Symbol.asyncIterator]()

    const next = iterator.next()
    controller.abort()
    const result = await next

    expect(result.done).toBe(true)
    expect(abortCalledWith).toBe("session_created")
  })

  test("maps prompt failures to a stable adapter error code", async () => {
    const workspaceRoot = await createWorkspace()
    const apiClient = createHealthyClient(workspaceRoot, {
      sessionPrompt: async () => {
        throw new Error("provider failed")
      },
    })
    const client = new RealOpenCodeClient({
      server: {
        ensure: async () => createConnection(workspaceRoot, apiClient),
      } as unknown as ManagedOpenCodeServer,
    })
    const session = await client.ensureSession({
      runId: "run_error",
      conversationId: "conv_error",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_error",
      workspaceRootPath: workspaceRoot,
    })

    try {
      for await (const _event of client.streamPrompt({
        session,
        prompt: {
          scope: "conversation-visible",
          content: "Fail",
        },
        signal: new AbortController().signal,
      })) {
        // no-op
      }
      throw new Error("expected prompt to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(ExternalAdapterError)
      expect((error as ExternalAdapterError).code).toBe("ADAPTER_PROMPT_FAILED")
    }
  })
})

const opencodeSmokeTest = process.env.AGENTHUB_OPENCODE_SMOKE === "1" ? test : test.skip
const opencodePromptSmokeTest = process.env.AGENTHUB_OPENCODE_PROMPT_SMOKE === "1" ? test : test.skip

describe("OpenCode optional smoke tests", () => {
  opencodeSmokeTest("starts a real workspace-scoped OpenCode server and validates project/path", async () => {
    const workspaceRoot = await createWorkspace()
    const server = new ManagedOpenCodeServer()

    try {
      const connection = await server.ensure(workspaceRoot)
      expect(connection.server.url).toStartWith("http://127.0.0.1:")
      expect(connection.directory).toBe(workspaceRoot)
    } finally {
      await server.closeAll()
    }
  })

  opencodePromptSmokeTest("runs a real direct OpenCode prompt using the user's configured provider", async () => {
    const workspaceRoot = await createWorkspace()
    const server = new ManagedOpenCodeServer()
    const client = new RealOpenCodeClient({ server })

    try {
      const session = await client.ensureSession({
        runId: "run_opencode_prompt_smoke",
        conversationId: "conv_opencode_prompt_smoke",
        agentId: "opencode",
        scope: "conversation-visible",
        workspaceId: "workspace_opencode_prompt_smoke",
        workspaceRootPath: workspaceRoot,
      })
      const events = []
      for await (const event of client.streamPrompt({
        session,
        prompt: {
          scope: "conversation-visible",
          content: "Reply with a short confirmation that OpenCode is connected.",
        },
        signal: new AbortController().signal,
      })) {
        events.push(event)
      }

      expect(events.some((event) => event.type === "message.completed" && event.content.length > 0)).toBe(true)
    } finally {
      await server.closeAll()
    }
  })
})
