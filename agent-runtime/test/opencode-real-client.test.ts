import { describe, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { EventEmitter } from "node:events"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import { promisify } from "node:util"
import {
  ExternalAdapterError,
  ManagedOpenCodeServer,
  RealOpenCodeClient,
  WorkspaceDiffService,
  WorkspaceService,
  extractAssistantText,
  type OpenCodeApiClient,
  type OpenCodeWorkspaceConnection,
} from "../src/runtime"

const execFileAsync = promisify(execFile)

async function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "agent-runtime-real-opencode-"))
}

async function runGit(workspaceRoot: string, args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", workspaceRoot, ...args], {
    encoding: "utf8",
    windowsHide: true,
  })
}

async function createGitWorkspace(): Promise<{
  workspaceRoot: string
  workspaceService: WorkspaceService
}> {
  const workspaceRoot = await createWorkspace()
  await writeFile(join(workspaceRoot, "README.md"), "AgentHub OpenCode smoke workspace\n", "utf8")
  await runGit(workspaceRoot, ["init"])
  await runGit(workspaceRoot, ["config", "user.email", "agenthub@example.local"])
  await runGit(workspaceRoot, ["config", "user.name", "AgentHub Test"])
  await runGit(workspaceRoot, ["add", "."])
  await runGit(workspaceRoot, ["commit", "-m", "initial"])
  return {
    workspaceRoot,
    workspaceService: new WorkspaceService({
      workdir: workspaceRoot,
      workspaceId: "workspace_opencode_write_smoke",
      runId: "run_opencode_write_smoke",
    }),
  }
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
  sessionPrompt: (
    text: string,
    signal?: AbortSignal,
    agent?: string
  ) => Promise<unknown>
  sessionAbort: (id: string) => Promise<unknown>
  eventSubscribe: (parameters?: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>
  permissionReply: (
    requestId: string,
    reply?: "once" | "always" | "reject",
    message?: string
  ) => Promise<unknown>
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
      get: async (options: { path?: { id?: string }; sessionID?: string }) => {
        const id = options.sessionID ?? options.path?.id ?? ""
        if (overrides.sessionGet) {
          return overrides.sessionGet(id)
        }
        return response(createSession(id, "Existing"))
      },
      create: async (options?: { body?: { title?: string }; title?: string }) => {
        const title = options?.title ?? options?.body?.title
        if (overrides.sessionCreate) {
          return overrides.sessionCreate(title)
        }
        return response(createSession("session_created", title ?? "Untitled"))
      },
      prompt: async (options: {
        agent?: string
        parts?: Array<{ text?: string }>
        body?: { agent?: string; parts?: Array<{ text?: string }> }
        signal?: AbortSignal
      }, requestOptions?: { signal?: AbortSignal }) => {
        const text = options.parts?.[0]?.text ?? options.body?.parts?.[0]?.text ?? ""
        const signal = requestOptions?.signal ?? options.signal
        const agent = options.agent ?? options.body?.agent
        if (overrides.sessionPrompt) {
          return overrides.sessionPrompt(text, signal, agent)
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
      abort: async (options: { path?: { id?: string }; sessionID?: string }) => {
        const id = options.sessionID ?? options.path?.id ?? ""
        if (overrides.sessionAbort) {
          return overrides.sessionAbort(id)
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
    event: {
      subscribe: async (parameters?: unknown, options?: { signal?: AbortSignal }) => {
        if (overrides.eventSubscribe) {
          return overrides.eventSubscribe(parameters, options)
        }
        return {
          stream: (async function* emptyOpenCodeEventStream() {})(),
        }
      },
    },
    permission: {
      reply: async (options: {
        requestID?: string
        permissionID?: string
        reply?: "once" | "always" | "reject"
        response?: "once" | "always" | "reject"
        message?: string
      }) => {
        const requestId = options.requestID ?? options.permissionID ?? ""
        if (overrides.permissionReply) {
          return overrides.permissionReply(
            requestId,
            options.reply ?? options.response,
            options.message
          )
        }
        return response(true)
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

  test("maps OpenCode event stream text and tool events without duplicating final text", async () => {
    const workspaceRoot = await createWorkspace()
    const opencodeEvents = [
      {
        id: "evt_text_delta",
        type: "session.next.text.delta",
        properties: {
          timestamp: Date.now(),
          sessionID: "session_created",
          delta: "Streamed answer",
        },
      },
      {
        id: "evt_other_session_tool",
        type: "session.next.tool.called",
        properties: {
          timestamp: Date.now(),
          sessionID: "session_other",
          callID: "call_ignored",
          tool: "edit",
          input: { file: "ignored.ts" },
          provider: { executed: true },
        },
      },
      {
        id: "evt_tool_called",
        type: "session.next.tool.called",
        properties: {
          timestamp: Date.now(),
          sessionID: "session_created",
          callID: "call_edit",
          tool: "edit",
          input: { file: "src/index.ts" },
          provider: { executed: true, metadata: { source: "opencode" } },
        },
      },
      {
        id: "evt_tool_success",
        type: "session.next.tool.success",
        properties: {
          timestamp: Date.now(),
          sessionID: "session_created",
          callID: "call_edit",
          structured: { changed: true },
          content: [{ type: "text", text: "Updated src/index.ts" }],
          provider: { executed: true },
        },
      },
    ]
    const apiClient = createHealthyClient(workspaceRoot, {
      eventSubscribe: async () => ({
        stream: (async function* streamOpenCodeEvents() {
          for (const event of opencodeEvents) {
            yield event
          }
        })(),
      }),
      sessionPrompt: async () => response({
        info: {
          id: "message_assistant",
          role: "assistant",
          sessionID: "session_created",
        },
        parts: [{ type: "text", text: "Streamed answer" }],
      }),
    })
    const client = new RealOpenCodeClient({
      server: {
        ensure: async () => createConnection(workspaceRoot, apiClient),
      } as unknown as ManagedOpenCodeServer,
    })
    const session = await client.ensureSession({
      runId: "run_event_stream",
      conversationId: "conv_event_stream",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_event_stream",
      workspaceRootPath: workspaceRoot,
    })

    const events = []
    for await (const event of client.streamPrompt({
      session,
      prompt: {
        scope: "conversation-visible",
        content: "Stream and edit",
      },
      signal: new AbortController().signal,
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: "message.delta", delta: "Streamed answer" },
      {
        type: "tool.started",
        providerEventId: "evt_tool_called",
        providerToolCallId: "call_edit",
        providerToolName: "edit",
        input: { file: "src/index.ts" },
        providerExecuted: true,
        providerMetadata: { source: "opencode" },
      },
      {
        type: "tool.completed",
        providerEventId: "evt_tool_success",
        providerToolCallId: "call_edit",
        providerToolName: "edit",
        output: {
          structured: { changed: true },
          content: [{ type: "text", text: "Updated src/index.ts" }],
        },
        providerExecuted: true,
      },
      {
        type: "message.completed",
        content: "Streamed answer",
      },
    ])
  })

  test("maps legacy message.part.* stream text and tool lifecycle without duplicating final text", async () => {
    const workspaceRoot = await createWorkspace()
    // Shapes captured from a real `opencode serve` 1.15.13 /event stream driven
    // by the legacy session.prompt() agent loop.
    const opencodeEvents = [
      {
        id: "evt_reasoning_part",
        type: "message.part.updated",
        properties: {
          sessionID: "session_created",
          part: {
            id: "prt_reasoning",
            messageID: "msg_assistant",
            sessionID: "session_created",
            type: "reasoning",
            text: "",
            time: { start: 1 },
          },
        },
      },
      {
        id: "evt_reasoning_delta",
        type: "message.part.delta",
        properties: {
          sessionID: "session_created",
          messageID: "msg_assistant",
          partID: "prt_reasoning",
          field: "text",
          delta: "Thinking...",
        },
      },
      {
        id: "evt_reasoning_ended",
        type: "message.part.updated",
        properties: {
          sessionID: "session_created",
          part: {
            id: "prt_reasoning",
            messageID: "msg_assistant",
            sessionID: "session_created",
            type: "reasoning",
            text: "Thinking...",
            time: { start: 1, end: 2 },
          },
        },
      },
      {
        id: "evt_reasoning_ended_repeat",
        type: "message.part.updated",
        properties: {
          sessionID: "session_created",
          part: {
            id: "prt_reasoning",
            messageID: "msg_assistant",
            sessionID: "session_created",
            type: "reasoning",
            text: "Thinking...",
            time: { start: 1, end: 2 },
          },
        },
      },
      {
        id: "evt_text_part",
        type: "message.part.updated",
        properties: {
          sessionID: "session_created",
          part: {
            id: "prt_text",
            messageID: "msg_assistant",
            sessionID: "session_created",
            type: "text",
            text: "",
          },
        },
      },
      {
        id: "evt_text_delta_other_session",
        type: "message.part.delta",
        properties: {
          sessionID: "session_other",
          messageID: "msg_other",
          partID: "prt_other",
          field: "text",
          delta: "ignored",
        },
      },
      {
        id: "evt_text_delta",
        type: "message.part.delta",
        properties: {
          sessionID: "session_created",
          messageID: "msg_assistant",
          partID: "prt_text",
          field: "text",
          delta: "Streamed answer",
        },
      },
      {
        id: "evt_tool_pending",
        type: "message.part.updated",
        properties: {
          sessionID: "session_created",
          part: {
            id: "prt_tool",
            messageID: "msg_assistant",
            sessionID: "session_created",
            type: "tool",
            tool: "read",
            callID: "call_read",
            state: { status: "pending", input: {}, raw: "" },
          },
        },
      },
      {
        id: "evt_tool_running",
        type: "message.part.updated",
        properties: {
          sessionID: "session_created",
          part: {
            id: "prt_tool",
            messageID: "msg_assistant",
            sessionID: "session_created",
            type: "tool",
            tool: "read",
            callID: "call_read",
            state: {
              status: "running",
              input: { filePath: "src/index.ts" },
              time: { start: 2 },
            },
          },
        },
      },
      {
        id: "evt_tool_completed",
        type: "message.part.updated",
        properties: {
          sessionID: "session_created",
          part: {
            id: "prt_tool",
            messageID: "msg_assistant",
            sessionID: "session_created",
            type: "tool",
            tool: "read",
            callID: "call_read",
            state: {
              status: "completed",
              input: { filePath: "src/index.ts" },
              output: "file contents",
              title: "src/index.ts",
              metadata: { truncated: false },
              time: { start: 2, end: 3 },
            },
          },
        },
      },
    ]
    const apiClient = createHealthyClient(workspaceRoot, {
      eventSubscribe: async () => ({
        stream: (async function* streamOpenCodeEvents() {
          for (const event of opencodeEvents) {
            yield event
          }
        })(),
      }),
      sessionPrompt: async () => response({
        info: {
          id: "msg_assistant",
          role: "assistant",
          sessionID: "session_created",
        },
        parts: [{ type: "text", text: "Streamed answer" }],
      }),
    })
    const client = new RealOpenCodeClient({
      server: {
        ensure: async () => createConnection(workspaceRoot, apiClient),
      } as unknown as ManagedOpenCodeServer,
    })
    const session = await client.ensureSession({
      runId: "run_part_stream",
      conversationId: "conv_part_stream",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_part_stream",
      workspaceRootPath: workspaceRoot,
    })

    const events = []
    for await (const event of client.streamPrompt({
      session,
      prompt: {
        scope: "conversation-visible",
        content: "Read and answer",
      },
      signal: new AbortController().signal,
    })) {
      events.push(event)
    }

    // Reasoning delta routed away from chat text; foreign-session delta dropped.
    expect(events).toContainEqual({
      type: "reasoning.delta",
      reasoningId: "prt_reasoning",
      delta: "Thinking...",
    })
    // Reasoning part finishing (time.end) closes the thinking block exactly once.
    expect(events).toContainEqual({
      type: "reasoning.completed",
      reasoningId: "prt_reasoning",
      content: "Thinking...",
    })
    expect(events.filter((event) => event.type === "reasoning.completed")).toHaveLength(1)
    expect(events).toContainEqual({ type: "message.delta", delta: "Streamed answer" })
    expect(events.filter((event) => event.type === "message.delta")).toHaveLength(1)

    // Tool lifecycle: a single started (with real input, not the empty pending
    // snapshot) plus a single completed.
    const started = events.find((event) => event.type === "tool.started")
    expect(started).toEqual({
      type: "tool.started",
      providerEventId: "evt_tool_running",
      providerToolCallId: "call_read",
      providerToolName: "read",
      input: { filePath: "src/index.ts" },
      providerExecuted: true,
      providerMetadata: undefined,
    })
    expect(events.filter((event) => event.type === "tool.started")).toHaveLength(1)
    const completed = events.find((event) => event.type === "tool.completed")
    expect(completed?.providerToolName).toBe("read")
    expect(completed?.providerToolCallId).toBe("call_read")
    expect(events.filter((event) => event.type === "tool.completed")).toHaveLength(1)

    // Final completed message carries the text once (no duplicate append since
    // the part stream already produced the delta).
    expect(events.at(-1)).toEqual({
      type: "message.completed",
      content: "Streamed answer",
    })
  })

  test("replies once to approved OpenCode permission requests", async () => {
    const workspaceRoot = await createWorkspace()
    const permissionRequests: unknown[] = []
    const permissionReplies: Array<{ requestId: string; reply?: string; message?: string }> = []
    const apiClient = createHealthyClient(workspaceRoot, {
      eventSubscribe: async () => ({
        stream: (async function* streamOpenCodeEvents() {
          yield {
            id: "evt_permission_asked",
            type: "permission.asked",
            properties: {
              id: "perm_edit",
              sessionID: "session_created",
              permission: "edit",
              patterns: ["src/index.ts"],
              always: [],
              metadata: { reason: "edit file" },
              tool: {
                messageID: "msg_assistant",
                callID: "call_edit",
              },
            },
          }
        })(),
      }),
      permissionReply: async (requestId, reply, message) => {
        permissionReplies.push({ requestId, reply, message })
        return response(true)
      },
      sessionPrompt: async () => response({
        info: {
          id: "msg_assistant",
          role: "assistant",
          sessionID: "session_created",
        },
        parts: [{ type: "text", text: "Edited after approval" }],
      }),
    })
    const client = new RealOpenCodeClient({
      server: {
        ensure: async () => createConnection(workspaceRoot, apiClient),
      } as unknown as ManagedOpenCodeServer,
    })
    const session = await client.ensureSession({
      runId: "run_permission_approved",
      conversationId: "conv_permission_approved",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_permission_approved",
      workspaceRootPath: workspaceRoot,
    })

    const events = []
    for await (const event of client.streamPrompt({
      session,
      prompt: {
        scope: "conversation-visible",
        content: "Edit the file",
      },
      signal: new AbortController().signal,
      permissionHandler: async (request: unknown) => {
        permissionRequests.push(request)
        return { approved: true, reason: "Approved once" }
      },
    } as any)) {
      events.push(event)
    }

    expect(permissionRequests).toHaveLength(1)
    expect(permissionRequests[0]).toMatchObject({
      providerPermissionId: "perm_edit",
      permissionKind: "edit",
      patterns: ["src/index.ts"],
      providerToolCallId: "call_edit",
      providerMessageId: "msg_assistant",
    })
    expect(permissionReplies).toEqual([{
      requestId: "perm_edit",
      reply: "once",
      message: "Approved once",
    }])
    expect(events.at(-1)).toEqual({
      type: "message.completed",
      content: "Edited after approval",
    })
  })

  test("normalizes current OpenCode permission.updated events", async () => {
    const workspaceRoot = await createWorkspace()
    const permissionRequests: unknown[] = []
    const permissionReplies: Array<{ requestId: string; reply?: string; message?: string }> = []
    const apiClient = createHealthyClient(workspaceRoot, {
      eventSubscribe: async () => ({
        stream: (async function* streamOpenCodeEvents() {
          yield {
            id: "evt_permission_updated",
            type: "permission.updated",
            properties: {
              id: "perm_write",
              type: "edit",
              pattern: ["src/index.ts", "src/app.ts"],
              sessionID: "session_created",
              messageID: "msg_assistant",
              callID: "call_edit",
              title: "Edit files",
              metadata: { reason: "needs file edits" },
              time: { created: Date.now() },
            },
          }
        })(),
      }),
      permissionReply: async (requestId, reply, message) => {
        permissionReplies.push({ requestId, reply, message })
        return response(true)
      },
      sessionPrompt: async () => response({
        info: {
          id: "msg_assistant",
          role: "assistant",
          sessionID: "session_created",
        },
        parts: [{ type: "text", text: "Edited after updated permission" }],
      }),
    })
    const client = new RealOpenCodeClient({
      server: {
        ensure: async () => createConnection(workspaceRoot, apiClient),
      } as unknown as ManagedOpenCodeServer,
    })
    const session = await client.ensureSession({
      runId: "run_permission_updated",
      conversationId: "conv_permission_updated",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_permission_updated",
      workspaceRootPath: workspaceRoot,
    })

    const events = []
    for await (const event of client.streamPrompt({
      session,
      prompt: {
        scope: "conversation-visible",
        content: "Edit files",
      },
      signal: new AbortController().signal,
      permissionHandler: async (request: unknown) => {
        permissionRequests.push(request)
        return { approved: true, reason: "Approved current event" }
      },
    } as any)) {
      events.push(event)
    }

    expect(permissionRequests).toHaveLength(1)
    expect(permissionRequests[0]).toMatchObject({
      providerPermissionId: "perm_write",
      permissionKind: "edit",
      patterns: ["src/index.ts", "src/app.ts"],
      providerToolCallId: "call_edit",
      providerMessageId: "msg_assistant",
    })
    expect(permissionReplies).toEqual([{
      requestId: "perm_write",
      reply: "once",
      message: "Approved current event",
    }])
    expect(events.at(-1)).toEqual({
      type: "message.completed",
      content: "Edited after updated permission",
    })
  })

  test("replies reject to denied OpenCode permission requests", async () => {
    const workspaceRoot = await createWorkspace()
    const permissionReplies: Array<{ requestId: string; reply?: string; message?: string }> = []
    const apiClient = createHealthyClient(workspaceRoot, {
      eventSubscribe: async () => ({
        stream: (async function* streamOpenCodeEvents() {
          yield {
            id: "evt_permission_asked",
            type: "permission.asked",
            properties: {
              id: "perm_bash",
              sessionID: "session_created",
              permission: "bash",
              patterns: ["bun test"],
              tool: {
                messageID: "msg_assistant",
                callID: "call_bash",
              },
            },
          }
        })(),
      }),
      permissionReply: async (requestId, reply, message) => {
        permissionReplies.push({ requestId, reply, message })
        return response(true)
      },
      sessionPrompt: async () => response({
        info: {
          id: "msg_assistant",
          role: "assistant",
          sessionID: "session_created",
        },
        parts: [{ type: "text", text: "I will continue without that command." }],
      }),
    })
    const client = new RealOpenCodeClient({
      server: {
        ensure: async () => createConnection(workspaceRoot, apiClient),
      } as unknown as ManagedOpenCodeServer,
    })
    const session = await client.ensureSession({
      runId: "run_permission_denied",
      conversationId: "conv_permission_denied",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_permission_denied",
      workspaceRootPath: workspaceRoot,
    })

    const events = []
    for await (const event of client.streamPrompt({
      session,
      prompt: {
        scope: "conversation-visible",
        content: "Run tests",
      },
      signal: new AbortController().signal,
      permissionHandler: async () => ({ approved: false, reason: "Not this command" }),
    })) {
      events.push(event)
    }

    expect(permissionReplies).toEqual([{
      requestId: "perm_bash",
      reply: "reject",
      message: "Not this command",
    }])
    expect(events.at(-1)).toEqual({
      type: "message.completed",
      content: "I will continue without that command.",
    })
  })

  test("replies reject when a run is cancelled while OpenCode waits for permission", async () => {
    const workspaceRoot = await createWorkspace()
    const permissionReplies: Array<{ requestId: string; reply?: string; message?: string }> = []
    let resolvePermissionDecision: ((decision: { approved: boolean; reason?: string }) => void) | undefined
    const apiClient = createHealthyClient(workspaceRoot, {
      eventSubscribe: async () => ({
        stream: (async function* streamOpenCodeEvents() {
          yield {
            id: "evt_permission_asked",
            type: "permission.asked",
            properties: {
              id: "perm_cancelled",
              sessionID: "session_created",
              permission: "edit",
              patterns: ["src/index.ts"],
              tool: {
                messageID: "msg_assistant",
                callID: "call_edit",
              },
            },
          }
        })(),
      }),
      permissionReply: async (requestId, reply, message) => {
        permissionReplies.push({ requestId, reply, message })
        return response(true)
      },
      sessionPrompt: async (_text, signal) => new Promise((resolve) => {
        signal?.addEventListener("abort", () => resolve(response({
          info: {
            id: "msg_assistant",
            role: "assistant",
            sessionID: "session_created",
          },
          parts: [{ type: "text", text: "late" }],
        })), { once: true })
      }),
    })
    const client = new RealOpenCodeClient({
      server: {
        ensure: async () => createConnection(workspaceRoot, apiClient),
      } as unknown as ManagedOpenCodeServer,
    })
    const session = await client.ensureSession({
      runId: "run_permission_cancelled",
      conversationId: "conv_permission_cancelled",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_permission_cancelled",
      workspaceRootPath: workspaceRoot,
    })
    const controller = new AbortController()
    const eventsPromise = (async () => {
      const events = []
      for await (const event of client.streamPrompt({
        session,
        prompt: {
          scope: "conversation-visible",
          content: "Edit then cancel",
        },
        signal: controller.signal,
        permissionHandler: async () => new Promise<{ approved: boolean; reason?: string }>((resolve) => {
          resolvePermissionDecision = resolve
        }),
      })) {
        events.push(event)
      }
      return events
    })()

    for (let attempt = 0; attempt < 50 && !resolvePermissionDecision; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(resolvePermissionDecision).toBeDefined()
    controller.abort()
    resolvePermissionDecision?.({ approved: false, reason: "Run cancelled" })

    await eventsPromise
    expect(permissionReplies).toEqual([{
      requestId: "perm_cancelled",
      reply: "reject",
      message: "Run cancelled",
    }])
  })

  test("propagates OpenCode permission reply failures as a stable adapter error", async () => {
    const workspaceRoot = await createWorkspace()
    const apiClient = createHealthyClient(workspaceRoot, {
      eventSubscribe: async () => ({
        stream: (async function* streamOpenCodeEvents() {
          yield {
            id: "evt_permission_asked",
            type: "permission.asked",
            properties: {
              id: "perm_reply_failure",
              sessionID: "session_created",
              permission: "edit",
              patterns: ["src/index.ts"],
              tool: {
                messageID: "msg_assistant",
                callID: "call_edit",
              },
            },
          }
        })(),
      }),
      permissionReply: async () => {
        throw new Error("reply endpoint unavailable")
      },
      sessionPrompt: async () => response({
        info: {
          id: "msg_assistant",
          role: "assistant",
          sessionID: "session_created",
        },
        parts: [{ type: "text", text: "Should not be returned" }],
      }),
    })
    const client = new RealOpenCodeClient({
      server: {
        ensure: async () => createConnection(workspaceRoot, apiClient),
      } as unknown as ManagedOpenCodeServer,
    })
    const session = await client.ensureSession({
      runId: "run_permission_reply_failure",
      conversationId: "conv_permission_reply_failure",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_permission_reply_failure",
      workspaceRootPath: workspaceRoot,
    })

    try {
      for await (const _event of client.streamPrompt({
        session,
        prompt: {
          scope: "conversation-visible",
          content: "Edit the file",
        },
        signal: new AbortController().signal,
        permissionHandler: async () => ({ approved: true, reason: "Approved once" }),
      })) {
        // no-op
      }
      throw new Error("expected permission reply to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(ExternalAdapterError)
      expect((error as ExternalAdapterError).code).toBe("ADAPTER_PERMISSION_REPLY_FAILED")
    }
  })

  test("waits for OpenCode event subscription before dispatching prompt", async () => {
    const workspaceRoot = await createWorkspace()
    let subscriptionReady = false
    let promptSawSubscriptionReady = false
    const apiClient = createHealthyClient(workspaceRoot, {
      eventSubscribe: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        subscriptionReady = true
        return {
          stream: (async function* emptyOpenCodeEventStream() {})(),
        }
      },
      sessionPrompt: async () => {
        promptSawSubscriptionReady = subscriptionReady
        return response({
          info: {
            id: "message_assistant",
            role: "assistant",
            sessionID: "session_created",
          },
          parts: [{ type: "text", text: "Ready after subscription" }],
        })
      },
    })
    const client = new RealOpenCodeClient({
      server: {
        ensure: async () => createConnection(workspaceRoot, apiClient),
      } as unknown as ManagedOpenCodeServer,
    })
    const session = await client.ensureSession({
      runId: "run_event_stream_ready",
      conversationId: "conv_event_stream_ready",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_event_stream_ready",
      workspaceRootPath: workspaceRoot,
    })

    for await (const _event of client.streamPrompt({
      session,
      prompt: {
        scope: "conversation-visible",
        content: "Wait for event stream",
      },
      signal: new AbortController().signal,
    })) {
      // drain prompt stream
    }

    expect(promptSawSubscriptionReady).toBe(true)
  })

  test("falls back to prompt response when OpenCode event subscription does not stop", async () => {
    const workspaceRoot = await createWorkspace()
    const apiClient = createHealthyClient(workspaceRoot, {
      eventSubscribe: async () => {
        await new Promise(() => {})
      },
      sessionPrompt: async () => response({
        info: {
          id: "message_assistant",
          role: "assistant",
          sessionID: "session_created",
        },
        parts: [{ type: "text", text: "Fallback response" }],
      }),
    })
    const client = new RealOpenCodeClient({
      server: {
        ensure: async () => createConnection(workspaceRoot, apiClient),
      } as unknown as ManagedOpenCodeServer,
    })
    const session = await client.ensureSession({
      runId: "run_event_stream_hung",
      conversationId: "conv_event_stream_hung",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_event_stream_hung",
      workspaceRootPath: workspaceRoot,
    })

    const controller = new AbortController()
    const eventsPromise = (async () => {
      const events = []
      for await (const event of client.streamPrompt({
        session,
        prompt: {
          scope: "conversation-visible",
          content: "Use prompt fallback",
        },
        signal: controller.signal,
      })) {
        events.push(event)
      }
      return events
    })()

    const result = await Promise.race([
      eventsPromise,
      new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 700)),
    ])
    if (result === "timed-out") {
      controller.abort()
    }

    expect(result).toEqual([
      { type: "message.delta", delta: "Fallback response" },
      { type: "message.completed", content: "Fallback response" },
    ])
  })

  test("falls back to prompt response when OpenCode event stream throws", async () => {
    const workspaceRoot = await createWorkspace()
    const apiClient = createHealthyClient(workspaceRoot, {
      eventSubscribe: async () => ({
        stream: (async function* failingOpenCodeEventStream() {
          throw new Error("event stream disconnected")
        })(),
      }),
      sessionPrompt: async () => response({
        info: {
          id: "message_assistant",
          role: "assistant",
          sessionID: "session_created",
        },
        parts: [{ type: "text", text: "Fallback after stream error" }],
      }),
    })
    const client = new RealOpenCodeClient({
      server: {
        ensure: async () => createConnection(workspaceRoot, apiClient),
      } as unknown as ManagedOpenCodeServer,
    })
    const session = await client.ensureSession({
      runId: "run_event_stream_error",
      conversationId: "conv_event_stream_error",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_event_stream_error",
      workspaceRootPath: workspaceRoot,
    })

    const events = []
    for await (const event of client.streamPrompt({
      session,
      prompt: {
        scope: "conversation-visible",
        content: "Use fallback after event stream error",
      },
      signal: new AbortController().signal,
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: "message.delta", delta: "Fallback after stream error" },
      { type: "message.completed", content: "Fallback after stream error" },
    ])
  })

  test("forces Build agent for AgentHub-originated prompts", async () => {
    const workspaceRoot = await createWorkspace()
    let promptAgent: string | undefined
    const apiClient = createHealthyClient(workspaceRoot, {
      sessionPrompt: async (_text, _signal, agent) => {
        promptAgent = agent
        return response({
          info: {
            id: "message_assistant",
            role: "assistant",
            sessionID: "session_prompt",
          },
          parts: [{ type: "text", text: "Build mode response" }],
        })
      },
    })
    const client = new RealOpenCodeClient({
      server: {
        ensure: async () => createConnection(workspaceRoot, apiClient),
      } as unknown as ManagedOpenCodeServer,
    })
    const session = await client.ensureSession({
      runId: "run_build_agent",
      conversationId: "conv_build_agent",
      agentId: "opencode",
      scope: "conversation-visible",
      workspaceId: "workspace_build_agent",
      workspaceRootPath: workspaceRoot,
    })

    for await (const _event of client.streamPrompt({
      session,
      prompt: {
        scope: "conversation-visible",
        content: "Edit a file",
      },
      signal: new AbortController().signal,
    })) {
      // drain prompt stream
    }

    expect(promptAgent).toBe("build")
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
const opencodeWriteSmokeTest = process.env.AGENTHUB_OPENCODE_WRITE_SMOKE === "1" ? test : test.skip

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

  opencodeWriteSmokeTest("runs a real OpenCode write prompt and records workspace diff", async () => {
    const { workspaceRoot, workspaceService } = await createGitWorkspace()
    const diffService = new WorkspaceDiffService()
    const baseline = await diffService.captureBaseline(workspaceService)
    const server = new ManagedOpenCodeServer()
    const client = new RealOpenCodeClient({ server })
    const targetFile = "agenthub-opencode-smoke.txt"
    const targetContent = "AgentHub OpenCode write smoke"

    try {
      const session = await client.ensureSession({
        runId: "run_opencode_write_smoke",
        conversationId: "conv_opencode_write_smoke",
        agentId: "opencode",
        scope: "conversation-visible",
        workspaceId: "workspace_opencode_write_smoke",
        workspaceRootPath: workspaceRoot,
      })
      const events = []
      for await (const event of client.streamPrompt({
        session,
        prompt: {
          scope: "conversation-visible",
          content: [
            `Create a file named ${targetFile} in the current workspace.`,
            `The file content must include exactly this text: ${targetContent}.`,
            "Reply briefly after the file is written.",
          ].join("\n"),
        },
        signal: new AbortController().signal,
      })) {
        events.push(event)
      }

      const fileContent = await readFile(join(workspaceRoot, targetFile), "utf8")
      const summary = await diffService.summarize(workspaceService, baseline)

      expect(fileContent).toContain(targetContent)
      expect(events.some((event) => event.type === "message.completed" && event.content.length > 0)).toBe(true)
      expect(summary.changedFiles.some((file) => file.path === targetFile)).toBe(true)
      expect(summary.stats.filesChanged).toBeGreaterThan(0)
      expect(summary.patch?.text ?? "").toContain(targetContent)
    } finally {
      await server.closeAll()
    }
  })
})
