import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { RuntimePermissionService, RuntimeToolRegistry, WorkspaceService } from "../src/runtime"
import {
  createBashTool,
  createDefaultRuntimeToolRegistry,
} from "../src/runtime/tools"
import type { AgentDefinition } from "../src/agents"
import { presetAgents } from "../src/agents"
import type { AgentExecutionContext, RunEvent, RunInput } from "../src/runtime"

const runInput: RunInput = {
  conversationId: "conv_bash",
  mode: "single",
  participantAgentIds: ["coder"],
  addressedAgentIds: ["coder"],
  userMessage: {
    role: "user",
    content: "Run a command.",
  },
  history: [],
}

const bashAgent: AgentDefinition = {
  id: "coder",
  name: "Coder",
  description: "Test coder",
  tier: "primary",
  origin: "system",
  visibility: "visible",
  entryPolicy: "callable",
  delegationPolicy: "can-delegate",
  executorType: "ai-sdk",
  capabilities: ["implementation"],
  allowedSubagents: [],
  allowedTools: ["bash"],
  permissionPolicy: {
    filesystem: "none",
    shell: "limited",
    network: "none",
    deploy: "none",
  },
  toolPermissionRules: {
    bash: {
      "*": "allow",
    },
  },
  enabled: true,
  readonly: true,
}

async function createWorkspace(runId: string): Promise<WorkspaceService> {
  const root = await mkdtemp(join(tmpdir(), "agent-runtime-bash-"))
  await mkdir(join(root, "src"), { recursive: true })
  return new WorkspaceService({
    workdir: root,
    workspaceId: "workspace_bash",
    runId,
  })
}

async function createContext(overrides: Partial<AgentExecutionContext> = {}): Promise<{
  context: AgentExecutionContext
  events: RunEvent[]
  permissionService: RuntimePermissionService
}> {
  const runId = overrides.runId ?? "run_bash"
  const workspaceService = overrides.workspaceService ?? await createWorkspace(runId)
  const permissionService = overrides.permissionService ?? new RuntimePermissionService(workspaceService)
  const events: RunEvent[] = []
  const context: AgentExecutionContext = {
    runId,
    input: runInput,
    agent: bashAgent,
    signal: new AbortController().signal,
    workspaceService,
    permissionService,
    emitEvent: (event) => {
      events.push(event)
    },
    ...overrides,
  }

  return {
    context,
    events,
    permissionService,
  }
}

function createRegistry(): RuntimeToolRegistry {
  const registry = new RuntimeToolRegistry()
  registry.register(createBashTool())
  return registry
}

function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function quoteForSh(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function echoCommand(value: string): string {
  return process.platform === "win32"
    ? `Write-Output ${quoteForPowerShell(value)}`
    : `printf %s ${quoteForSh(value)}`
}

function sleepCommand(milliseconds: number): string {
  return process.platform === "win32"
    ? `Start-Sleep -Milliseconds ${milliseconds}`
    : `sleep ${Math.max(1, Math.ceil(milliseconds / 1000))}`
}

describe("bash tool", () => {
  test("invalid input returns TOOL_INVALID_INPUT before execution", async () => {
    const registry = createRegistry()
    const { context, events } = await createContext()

    const result = await registry.executeTool("bash", { command: "" }, context)

    expect(result.status).toBe("failed")
    expect(result.error?.code).toBe("TOOL_INVALID_INPUT")
    expect(events.some((event) => event.type === "tool.started")).toBe(false)
    expect(events.some((event) => event.type === "tool.failed")).toBe(true)
  })

  test("allowedTools and shell policy gate execution", async () => {
    const registry = createRegistry()

    const notAllowed = await registry.executeTool(
      "bash",
      { command: "pwd" },
      (await createContext({
        agent: {
          ...bashAgent,
          allowedTools: [],
        },
      })).context
    )
    expect(notAllowed.status).toBe("failed")
    expect(notAllowed.error?.code).toBe("TOOL_NOT_ALLOWED")

    const noShell = await registry.executeTool(
      "bash",
      { command: "pwd" },
      (await createContext({
        agent: {
          ...bashAgent,
          permissionPolicy: {
            ...bashAgent.permissionPolicy,
            shell: "none",
          },
        },
      })).context
    )
    expect(noShell.status).toBe("failed")
    expect(noShell.error?.code).toBe("TOOL_PERMISSION_DENIED")
  })

  test("allow rule executes directly and treats nonzero exit code as completed output", async () => {
    const registry = createRegistry()
    const { context, events } = await createContext()

    const output = await registry.executeTool(
      "bash",
      { command: echoCommand("hello from bash") },
      context,
      { toolCallId: "tool_bash_allow" }
    )
    expect(output.status).toBe("completed")
    expect((output.data as { stdout: string }).stdout).toContain("hello from bash")

    events.length = 0
    const nonzero = await registry.executeTool(
      "bash",
      { command: "exit 7" },
      context,
      { toolCallId: "tool_bash_nonzero" }
    )
    expect(nonzero.status).toBe("completed")
    expect((nonzero.data as { exitCode: number }).exitCode).toBe(7)
    expect(events.map((event) => event.type)).toEqual(["tool.started", "tool.completed"])
  })

  test("ask rule requests approval and resumes the same toolCallId after approval", async () => {
    const registry = createRegistry()
    const { context, events, permissionService } = await createContext({
      agent: {
        ...bashAgent,
        toolPermissionRules: {
          bash: {
            "*": "ask",
          },
        },
      },
    })

    const first = await registry.executeTool(
      "bash",
      { command: echoCommand("approved command"), cwd: "src" },
      context,
      { toolCallId: "tool_bash_approval" }
    )

    expect(first.status).toBe("failed")
    expect(first.error?.code).toBe("TOOL_APPROVAL_REQUIRED")
    expect(events.some((event) => event.type === "permission.requested")).toBe(true)
    expect(events.some((event) => event.type === "tool.started")).toBe(false)

    const request = permissionService.getRequestForToolCall("run_bash", "tool_bash_approval")
    expect(request?.data).toMatchObject({
      permissionType: "command_execute",
      approvalReason: "bash_command",
      command: echoCommand("approved command"),
      cwd: "src",
      matchedRule: "*",
      ruleAction: "ask",
    })

    permissionService.decide(request!.requestId, { approved: true }, (event) => {
      events.push(event)
    })
    events.length = 0

    const second = await registry.executeTool(
      "bash",
      { command: echoCommand("approved command"), cwd: "src" },
      context,
      { toolCallId: "tool_bash_approval" }
    )

    expect(second.status).toBe("completed")
    expect((second.data as { cwd: string; stdout: string }).cwd).toBe("src")
    expect((second.data as { stdout: string }).stdout).toContain("approved command")
    expect(events.some((event) => event.type === "permission.requested")).toBe(false)
    expect(events.map((event) => event.type)).toEqual(["tool.started", "tool.completed"])
  })

  test("deny rule fails before tool.started", async () => {
    const registry = createRegistry()
    const { context, events } = await createContext({
      agent: {
        ...bashAgent,
        toolPermissionRules: {
          bash: {
            "*": "ask",
            "rm *": "deny",
          },
        },
      },
    })

    const result = await registry.executeTool(
      "bash",
      { command: "rm -rf ." },
      context,
      { toolCallId: "tool_bash_denied" }
    )

    expect(result.status).toBe("failed")
    expect(result.error?.code).toBe("BASH_COMMAND_DENIED")
    expect(events.some((event) => event.type === "tool.started")).toBe(false)
    expect(events.map((event) => event.type)).toEqual(["tool.failed"])
  })

  test("timeout, cancellation, truncation, and cwd failures are structured", async () => {
    const registry = createRegistry()
    const { context } = await createContext()

    const timeout = await registry.executeTool(
      "bash",
      { command: sleepCommand(500), timeoutMs: 1 },
      context,
      { toolCallId: "tool_bash_timeout" }
    )
    expect(timeout.status).toBe("failed")
    expect(timeout.error?.code).toBe("BASH_TIMEOUT")

    const controller = new AbortController()
    const cancelledContext = (await createContext({
      signal: controller.signal,
    })).context
    const cancelledPromise = registry.executeTool(
      "bash",
      { command: sleepCommand(2_000), timeoutMs: 5_000 },
      cancelledContext,
      { toolCallId: "tool_bash_cancelled" }
    )
    setTimeout(() => controller.abort(), 20)
    const cancelled = await cancelledPromise
    expect(cancelled.status).toBe("cancelled")
    expect(cancelled.error?.code).toBe("TOOL_EXECUTION_ABORTED")

    const largeText = "x".repeat(128)
    const truncated = await registry.executeTool(
      "bash",
      { command: echoCommand(largeText), maxOutputBytes: 16 },
      context,
      { toolCallId: "tool_bash_truncated" }
    )
    expect(truncated.status).toBe("completed")
    const truncatedData = truncated.data as { stdout: string; truncated: boolean; stdoutBytes: number }
    expect(truncatedData.truncated).toBe(true)
    expect(truncatedData.stdoutBytes).toBeLessThanOrEqual(16)

    const badCwd = await registry.executeTool(
      "bash",
      { command: "pwd", cwd: process.cwd() },
      context,
      { toolCallId: "tool_bash_bad_cwd" }
    )
    expect(badCwd.status).toBe("failed")
    expect(badCwd.error?.code).toBe("BASH_INVALID_CWD")
  })

  test("fails clearly without a bound workspace", async () => {
    const registry = createRegistry()
    const result = await registry.executeTool("bash", { command: "pwd" }, {
      runId: "run_bash_no_workspace",
      input: runInput,
      agent: bashAgent,
      signal: new AbortController().signal,
      emitEvent: () => {},
      permissionService: new RuntimePermissionService(),
    }, { toolCallId: "tool_bash_no_workspace" })

    expect(result.status).toBe("failed")
    expect(result.error?.code).toBe("WORKSPACE_NOT_BOUND")
  })

  test("default registry registers bash while user authoring options hide it", () => {
    const registry = createDefaultRuntimeToolRegistry()
    const internalPrimaryAgents = presetAgents.filter((agent) =>
      agent.tier === "primary" &&
      agent.origin === "system" &&
      agent.executorType !== "external-adapter"
    )

    for (const agent of internalPrimaryAgents) {
      expect(agent.allowedTools).toContain("bash")
      expect(agent.permissionPolicy.shell).toBe("limited")
      expect(agent.toolPermissionRules?.bash?.["*"]).toBe("ask")
      expect(registry.listToolsForAgent(agent, { includeInternal: true }).map((tool) => tool.name)).toContain("bash")
    }

    const opencode = presetAgents.find((agent) => agent.id === "opencode")
    expect(opencode?.permissionPolicy.shell).toBe("limited")
    expect(opencode?.allowedTools).toEqual([])
    expect(registry.getTool("bash")).toBeTruthy()
    expect(registry.listUserConfigurableTools().map((tool) => tool.id)).not.toContain("bash")
  })
})
