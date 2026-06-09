import { afterEach, describe, expect, test } from "bun:test"
import type { AgentDefinition } from "../../agents"
import { RuntimePermissionService } from "../permissions"
import type { AgentExecutionContext, RunEvent, RunInput } from "../types"
import { createDefaultRuntimeToolRegistry } from "./runtime-tool-registry"

const deployAgent: AgentDefinition = {
  id: "deploy",
  name: "Deploy",
  description: "Deploy projects.",
  tier: "primary",
  origin: "system",
  visibility: "visible",
  entryPolicy: "callable",
  delegationPolicy: "terminal",
  executorType: "ai-sdk",
  systemPrompt: "Deploy.",
  capabilities: ["deploy"],
  allowedSubagents: [],
  allowedTools: [
    "connect_deploy_server",
    "run_deploy_command",
    "check_deployment_url",
  ],
  allowedSkills: [],
  permissionPolicy: {
    filesystem: "read",
    shell: "none",
    network: "limited",
    deploy: "publish",
  },
  enabled: true,
  readonly: true,
}

const nonDeployAgent: AgentDefinition = {
  ...deployAgent,
  id: "coder",
  name: "Coder",
  permissionPolicy: {
    filesystem: "read",
    shell: "none",
    network: "limited",
    deploy: "none",
  },
}

const runInput: RunInput = {
  conversationId: "conv_1",
  mode: "single",
  participantAgentIds: ["deploy"],
  userMessage: {
    role: "user",
    content: "deploy",
  },
  history: [],
}

const originalFetch = globalThis.fetch

function createContext(agent: AgentDefinition, events: RunEvent[]): AgentExecutionContext {
  return {
    runId: "run_1",
    input: runInput,
    agent,
    signal: new AbortController().signal,
    emitEvent: (event) => events.push(event),
    permissionService: new RuntimePermissionService(),
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("deployment runtime tools", () => {
  test("returns TOOL_INVALID_INPUT before starting a malformed deployment tool", async () => {
    const registry = createDefaultRuntimeToolRegistry()
    const events: RunEvent[] = []

    const result = await registry.executeTool(
      "connect_deploy_server",
      {},
      createContext(deployAgent, events),
      { toolCallId: "tool_connect" }
    )

    expect(result.status).toBe("failed")
    expect(result.error?.code).toBe("TOOL_INVALID_INPUT")
    expect(events.map((event) => event.type)).toEqual(["tool.failed"])
  })

  test("denies deployment tools to agents without deploy permission", async () => {
    const registry = createDefaultRuntimeToolRegistry()
    const events: RunEvent[] = []

    const result = await registry.executeTool(
      "run_deploy_command",
      {
        connectionId: "conn_1",
        command: "echo hi",
        reason: "smoke test",
      },
      createContext(nonDeployAgent, events),
      { toolCallId: "tool_command" }
    )

    expect(result.status).toBe("failed")
    expect(result.error?.code).toBe("TOOL_PERMISSION_DENIED")
    expect(events.map((event) => event.type)).toEqual(["tool.failed"])
  })

  test("requests approval before any remote command or deployment command event", async () => {
    const registry = createDefaultRuntimeToolRegistry({
      deploymentService: {
        getCommandApprovalContext: () => ({
          server: {
            id: "srv_1",
            displayName: "Production",
            user: "deploy",
          },
          cwd: "/srv/app",
        }),
        runCommand: async () => {
          throw new Error("Command must not run before approval")
        },
      },
    })
    const events: RunEvent[] = []

    const result = await registry.executeTool(
      "run_deploy_command",
      {
        connectionId: "conn_1",
        command: "docker --version",
        cwd: "/srv/app",
        reason: "Check Docker availability",
      },
      createContext(deployAgent, events),
      { toolCallId: "tool_command" }
    )

    expect(result.error?.code).toBe("TOOL_APPROVAL_REQUIRED")
    expect(events.map((event) => event.type)).toEqual(["permission.requested"])
    expect(events.some((event) => event.type === "deployment.command.started")).toBe(false)
    expect(events[0]?.data).toMatchObject({
      toolName: "run_deploy_command",
      data: {
        permissionType: "deployment",
        approvalReason: "deployment_command",
        serverDisplayName: "Production",
        user: "deploy",
        command: "docker --version",
        cwd: "/srv/app",
        reason: "Check Docker availability",
      },
    })
  })

  test("runs an approved remote command and emits deployment command events before tool completion", async () => {
    const registry = createDefaultRuntimeToolRegistry({
      deploymentService: {
        getCommandApprovalContext: () => ({
          server: {
            id: "srv_1",
            displayName: "Production",
            user: "deploy",
          },
          cwd: ".",
        }),
        runCommand: async (_input: unknown, context: { emitEvent: (event: RunEvent) => void; runId: string; agentId: string; toolCallId: string }) => {
          context.emitEvent({
            id: "evt_command_started",
            runId: context.runId,
            type: "deployment.command.started",
            timestamp: "2026-06-09T00:00:00.000Z",
            agentId: context.agentId,
            toolCallId: context.toolCallId,
            toolName: "run_deploy_command",
            data: {
              commandId: "cmd_1",
              connectionId: "conn_1",
              command: "echo ok",
            },
          })
          context.emitEvent({
            id: "evt_log",
            runId: context.runId,
            type: "deployment.log.appended",
            timestamp: "2026-06-09T00:00:01.000Z",
            agentId: context.agentId,
            toolCallId: context.toolCallId,
            toolName: "run_deploy_command",
            data: {
              commandId: "cmd_1",
              stream: "stdout",
              text: "ok\n",
            },
          })
          context.emitEvent({
            id: "evt_command_completed",
            runId: context.runId,
            type: "deployment.command.completed",
            timestamp: "2026-06-09T00:00:02.000Z",
            agentId: context.agentId,
            toolCallId: context.toolCallId,
            toolName: "run_deploy_command",
            data: {
              commandId: "cmd_1",
              exitCode: 0,
            },
          })
          return {
            status: "completed" as const,
            summary: "Remote command exited with code 0",
            data: {
              commandId: "cmd_1",
              exitCode: 0,
              stdout: "ok\n",
              stderr: "",
            },
          }
        },
      },
    })
    const events: RunEvent[] = []
    const context = createContext(deployAgent, events)

    await registry.executeTool(
      "run_deploy_command",
      {
        connectionId: "conn_1",
        command: "echo ok",
        reason: "smoke test",
      },
      context,
      { toolCallId: "tool_command" }
    )
    const request = context.permissionService?.listRequests("run_1")[0]
    if (!request) throw new Error("Expected approval request")
    context.permissionService?.decide(request.requestId, { approved: true }, (event) => events.push(event))

    const result = await registry.executeTool(
      "run_deploy_command",
      {
        connectionId: "conn_1",
        command: "echo ok",
        reason: "smoke test",
      },
      context,
      { toolCallId: "tool_command" }
    )

    expect(result.status).toBe("completed")
    expect(events.map((event) => event.type)).toEqual([
      "permission.requested",
      "permission.approved",
      "tool.started",
      "deployment.command.started",
      "deployment.log.appended",
      "deployment.command.completed",
      "tool.completed",
    ])
  })

  test("records deployment URL health checks as deployment preview state", async () => {
    globalThis.fetch = (async () => new Response("ok", { status: 204 })) as unknown as typeof fetch
    const registry = createDefaultRuntimeToolRegistry()
    const events: RunEvent[] = []

    const result = await registry.executeTool(
      "check_deployment_url",
      {
        deploymentId: "dep_1",
        url: "https://app.example.com/health",
        expectedStatus: 204,
        openPreview: true,
      },
      createContext(deployAgent, events),
      { toolCallId: "tool_health" }
    )

    expect(result.status).toBe("completed")
    expect(events.map((event) => event.type)).toEqual([
      "tool.started",
      "deployment.progress.updated",
      "deployment.preview.requested",
      "tool.completed",
    ])
    expect(events[1]?.data).toMatchObject({
      deploymentId: "dep_1",
      conversationId: "conv_1",
      message: "Deployment URL responded with 204",
      health: {
        url: "https://app.example.com/health",
        ok: true,
        status: 204,
      },
    })
    expect(events[2]?.data).toMatchObject({
      deploymentId: "dep_1",
      conversationId: "conv_1",
      url: "https://app.example.com/health",
      openMode: "preview-tab",
    })
  })
})
