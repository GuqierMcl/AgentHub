import { describe, expect, test } from "bun:test"
import type { AgentDefinition } from "../../agents"
import type { RunEvent } from "../types"
import { FakeOpenCodeClient, type OpenCodePromptRequest } from "./opencode-client"
import { OpenCodeAdapter } from "./opencode-adapter"
import type { ExternalAdapterContext, ExternalAdapterPrompt } from "./types"

const opencodeAgent: AgentDefinition & {
  external: NonNullable<AgentDefinition["external"]>
} = {
  id: "opencode",
  name: "OpenCode",
  description: "External OpenCode agent.",
  tier: "primary",
  origin: "external",
  visibility: "visible",
  entryPolicy: "callable",
  delegationPolicy: "terminal",
  executorType: "external-adapter",
  capabilities: ["code"],
  allowedSubagents: [],
  allowedTools: [],
  allowedSkills: [],
  permissionPolicy: {
    filesystem: "write",
    shell: "limited",
    network: "limited",
    deploy: "none",
  },
  external: {
    provider: "opencode",
    workingDirectoryPolicy: "user-workspace",
    configDirectoryPolicy: "user-global",
    outputFormat: "event-stream",
  },
  enabled: true,
  readonly: true,
}

class CapturingOpenCodeClient extends FakeOpenCodeClient {
  prompt: ExternalAdapterPrompt | null = null

  override async *streamPrompt(request: OpenCodePromptRequest) {
    this.prompt = request.prompt
    yield {
      type: "message.completed" as const,
      content: "Delegated task complete.",
    }
  }
}

function createDelegatedContext(): ExternalAdapterContext {
  return {
    runId: "run_delegate_context",
    agent: opencodeAgent,
    signal: new AbortController().signal,
    scope: "delegated-task",
    workspace: {
      workspaceId: "workspace_1",
      backendType: "local",
      rootPath: "D:/PyWorkSpace/AgentHub",
    },
    input: {
      conversationId: "conv_delegate_context",
      mode: "group",
      participantAgentIds: ["orchestrator", "opencode"],
      userMessage: {
        role: "user",
        content: "请开始部署这个项目。",
      },
      history: [
        {
          id: "msg_1",
          role: "user",
          content: "我们决定优先用 Docker Compose 部署。",
        },
        {
          id: "msg_2",
          role: "assistant",
          agentId: "orchestrator",
          content: "我会委派外部智能体检查部署文件。",
        },
      ],
    },
    task: {
      taskId: "task_deploy_context",
      targetAgentId: "opencode",
      title: "检查部署方案",
      instruction: "读取项目文件，确认 Docker Compose 是否可用。",
      expectedOutput: "给出可执行的部署步骤和风险提示。",
      requiredCapabilities: ["code"],
      riskLevel: "medium",
      dependsOn: [],
      lockPaths: [],
    },
  }
}

describe("OpenCodeAdapter delegated task context", () => {
  test("includes visible conversation history and the delegated task in the prompt", async () => {
    const client = new CapturingOpenCodeClient()
    const adapter = new OpenCodeAdapter(client)
    const events: RunEvent[] = []

    for await (const event of adapter.execute(createDelegatedContext())) {
      events.push(event)
    }

    expect(client.prompt?.scope).toBe("delegated-task")
    expect(client.prompt?.content).toContain("AgentHub visible context (bootstrap).")
    expect(client.prompt?.content).toContain("我们决定优先用 Docker Compose 部署。")
    expect(client.prompt?.content).toContain("Task instruction: 读取项目文件，确认 Docker Compose 是否可用。")
    expect(client.prompt?.content).toContain("User request: 请开始部署这个项目。")
  })
})
