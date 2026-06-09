import { describe, expect, it } from "bun:test"
import { applyRuntimeEventToTimeline } from "./timeline-projection"
import type { RuntimeRunEvent } from "../api/runtime-runs"
import type {
  WorkbenchTimelineChatMessageItem,
  WorkbenchTimelineItem,
} from "../types"

const AGENT = "opencode"
const RUN = "run_1"
const MSG = "msg_1"
const chatSpeakers = { [AGENT]: true as const }

let seq = 0
function event(
  type: string,
  data: Record<string, unknown>,
  extra: Partial<RuntimeRunEvent> = {}
): RuntimeRunEvent {
  seq += 1
  return {
    id: `evt_${seq}`,
    runId: RUN,
    type,
    timestamp: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
    agentId: AGENT,
    messageId: MSG,
    data,
    ...extra,
  }
}

function reasoningDelta(reasoningId: string, delta: string): RuntimeRunEvent {
  return event("reasoning.delta", { reasoningId, delta })
}
function reasoningCompleted(reasoningId: string, content: string): RuntimeRunEvent {
  return event("reasoning.completed", { reasoningId, content })
}
function toolStarted(callId: string, name: string): RuntimeRunEvent {
  return event(
    "tool.started",
    { summary: name, input: { x: 1 } },
    { toolCallId: callId, toolName: name }
  )
}
function toolCompleted(callId: string, name: string): RuntimeRunEvent {
  return event(
    "tool.completed",
    { data: { ok: true } },
    { toolCallId: callId, toolName: name }
  )
}

function project(events: RuntimeRunEvent[]): WorkbenchTimelineItem[] {
  return events.reduce<WorkbenchTimelineItem[]>(
    (items, ev) => applyRuntimeEventToTimeline(items, ev, chatSpeakers),
    []
  )
}

function chatMessage(items: WorkbenchTimelineItem[]): WorkbenchTimelineChatMessageItem {
  const chat = items.find(
    (item): item is WorkbenchTimelineChatMessageItem =>
      item.kind === "chat_message" && item.role === "assistant"
  )
  if (!chat) throw new Error("no assistant chat message")
  return chat
}

// Mirror the UI's merge: combine the four nested arrays and sort by `order`.
function mergedOrder(chat: WorkbenchTimelineChatMessageItem): string[] {
  type Tagged = { order: number; index: number; label: string }
  const tagged: Tagged[] = []
  let i = 0
  for (const b of chat.reasoningBlocks ?? []) {
    tagged.push({ order: b.order ?? i, index: i, label: `reason:${b.reasoningId}` })
    i += 1
  }
  for (const t of chat.toolItems ?? []) {
    tagged.push({ order: t.order ?? i, index: i, label: `tool:${t.toolCallId}` })
    i += 1
  }
  return tagged
    .sort((l, r) => (l.order !== r.order ? l.order - r.order : l.index - r.index))
    .map((t) => t.label)
}

describe("timeline interleave ordering", () => {
  it("preserves think -> tool -> think -> tool order across nested arrays", () => {
    const items = project([
      reasoningDelta("r1", "thinking about step 1"),
      reasoningCompleted("r1", "thinking about step 1"),
      toolStarted("c1", "read"),
      toolCompleted("c1", "read"),
      reasoningDelta("r2", "now step 2"),
      reasoningCompleted("r2", "now step 2"),
      toolStarted("c2", "edit"),
      toolCompleted("c2", "edit"),
    ])

    const chat = chatMessage(items)
    expect(mergedOrder(chat)).toEqual([
      "reason:r1",
      "tool:c1",
      "reason:r2",
      "tool:c2",
    ])
  })

  it("assigns increasing order to each new nested block", () => {
    const chat = chatMessage(
      project([
        reasoningDelta("r1", "a"),
        toolStarted("c1", "read"),
        reasoningDelta("r2", "b"),
      ])
    )
    const r1 = chat.reasoningBlocks?.find((b) => b.reasoningId === "r1")
    const r2 = chat.reasoningBlocks?.find((b) => b.reasoningId === "r2")
    const c1 = chat.toolItems?.find((t) => t.toolCallId === "c1")
    expect(r1?.order).toBe(1)
    expect(c1?.order).toBe(2)
    expect(r2?.order).toBe(3)
  })

  it("keeps a block's order stable across updates", () => {
    const chat = chatMessage(
      project([
        toolStarted("c1", "read"),
        reasoningDelta("r1", "a"),
        toolCompleted("c1", "read"), // update to c1, must not bump its order
      ])
    )
    const c1 = chat.toolItems?.find((t) => t.toolCallId === "c1")
    const r1 = chat.reasoningBlocks?.find((b) => b.reasoningId === "r1")
    expect(c1?.order).toBe(1)
    expect(r1?.order).toBe(2)
    expect(mergedOrder(chat)).toEqual(["tool:c1", "reason:r1"])
  })
})

describe("tool output projection", () => {
  it("updates empty external tool input when the completed event carries parsed arguments", () => {
    const chat = chatMessage(
      project([
        event(
          "tool.started",
          {
            summary: "Claude Code · Edit",
            externalProvider: "claude-code",
            input: {},
          },
          {
            toolCallId: "claude-code:toolu_edit",
            toolName: "Edit",
          }
        ),
        event(
          "tool.completed",
          {
            summary: "Claude Code · Edit",
            externalProvider: "claude-code",
            input: {
              file_path: "src/index.ts",
              new_string: "updated",
            },
            output: {
              content: "Updated src/index.ts",
            },
          },
          {
            toolCallId: "claude-code:toolu_edit",
            toolName: "Edit",
          }
        ),
      ])
    )

    const tool = chat.toolItems?.find((item) => item.toolCallId === "claude-code:toolu_edit")
    expect(tool).toMatchObject({
      status: "output-available",
      externalProvider: "claude-code",
      input: {
        file_path: "src/index.ts",
        new_string: "updated",
      },
      output: {
        content: "Updated src/index.ts",
      },
    })
  })

  it("does not downgrade a completed external tool when parsed input arrives late", () => {
    const chat = chatMessage(
      project([
        event(
          "tool.started",
          {
            summary: "Claude Code · Edit",
            externalProvider: "claude-code",
            input: {},
          },
          {
            toolCallId: "claude-code:toolu_edit",
            toolName: "Edit",
          }
        ),
        event(
          "tool.completed",
          {
            summary: "Claude Code · Edit",
            externalProvider: "claude-code",
            output: {
              content: "Updated src/index.ts",
            },
          },
          {
            toolCallId: "claude-code:toolu_edit",
            toolName: "Edit",
          }
        ),
        event(
          "tool.started",
          {
            summary: "Claude Code · Edit",
            externalProvider: "claude-code",
            input: {
              file_path: "src/index.ts",
              new_string: "updated",
            },
          },
          {
            toolCallId: "claude-code:toolu_edit",
            toolName: "Edit",
          }
        ),
      ])
    )

    const tool = chat.toolItems?.find((item) => item.toolCallId === "claude-code:toolu_edit")
    expect(tool).toMatchObject({
      status: "output-available",
      input: {
        file_path: "src/index.ts",
        new_string: "updated",
      },
      output: {
        content: "Updated src/index.ts",
      },
    })
  })

  it("uses OpenCode output payload for completed external tools", () => {
    const chat = chatMessage(
      project([
        event(
          "tool.completed",
          {
            summary: "OpenCode · edit",
            externalProvider: "opencode",
            output: {
              title: "Edited src/index.ts",
              output: "updated file",
            },
          },
          {
            toolCallId: "opencode:call_edit",
            toolName: "edit",
          }
        ),
      ])
    )

    const tool = chat.toolItems?.find((item) => item.toolCallId === "opencode:call_edit")
    expect(tool).toMatchObject({
      status: "output-available",
      title: "OpenCode · edit",
      externalProvider: "opencode",
      output: {
        title: "Edited src/index.ts",
        output: "updated file",
      },
    })
  })
})

describe("permission projection", () => {
  it("preserves deployment command approval details for review", () => {
    const chat = chatMessage(project([
      event(
        "permission.requested",
        {
          requestId: "permission_deploy_command",
          reason: "Deploy wants to run a remote deployment command.",
          data: {
            permissionType: "deployment",
            approvalReason: "deployment_command",
            serverDisplayName: "Production",
            user: "deploy",
            command: "docker compose up -d --build",
            cwd: "/srv/app",
            reason: "Publish the latest application image",
          },
        },
        {
          toolCallId: "tool_deploy_command",
          toolName: "run_deploy_command",
        }
      ),
    ]))

    expect(chat.permissionItems?.[0]).toMatchObject({
      target: "docker compose up -d --build",
      details: [
        { label: "服务器", value: "Production" },
        { label: "用户", value: "deploy" },
        { label: "命令", value: "docker compose up -d --build", code: true },
        { label: "工作目录", value: "/srv/app", code: true },
        { label: "部署原因", value: "Publish the latest application image" },
      ],
    })
  })

  it("preserves bash command approval details for review", () => {
    const chat = chatMessage(project([
      event(
        "permission.requested",
        {
          requestId: "permission_bash_command",
          reason: "Coder wants to run npm test.",
          data: {
            permissionType: "command_execute",
            approvalReason: "bash_command",
            command: "npm test",
            cwd: ".",
            matchedRule: "npm *",
            ruleAction: "ask",
            shell: "powershell.exe",
          },
        },
        {
          toolCallId: "tool_bash",
          toolName: "bash",
        }
      ),
    ]))

    expect(chat.permissionItems?.[0]).toMatchObject({
      target: "npm test",
      details: [
        { label: "命令", value: "npm test", code: true },
        { label: "工作目录", value: ".", code: true },
        { label: "Shell", value: "powershell.exe" },
        { label: "规则", value: "npm * -> ask" },
      ],
    })
  })

  it("preserves network request approval details for review", () => {
    const chat = chatMessage(project([
      event(
        "permission.requested",
        {
          requestId: "permission_network",
          reason: "Coder wants to fetch external docs.",
          data: {
            permissionType: "network_access",
            approvalReason: "network_request",
            method: "GET",
            url: "https://example.com/search?redacted",
            host: "example.com",
          },
        },
        {
          toolCallId: "tool_fetch",
          toolName: "web_fetch",
        }
      ),
    ]))

    expect(chat.permissionItems?.[0]).toMatchObject({
      target: "https://example.com/search?redacted",
      details: [
        { label: "方法", value: "GET" },
        { label: "URL", value: "https://example.com/search?redacted", code: true },
        { label: "Host", value: "example.com" },
      ],
    })
  })

  it("preserves workspace approval details for review", () => {
    const chat = chatMessage(project([
      event(
        "permission.requested",
        {
          requestId: "permission_workspace",
          reason: "Coder needs to write a file outside the default grant.",
          data: {
            workspaceId: "workspace_1",
            logicalPath: "mounts/docs/README.md",
            targetKind: "file",
            accessMode: "write",
            approvalReason: "write_file",
          },
        },
        {
          toolCallId: "tool_write",
          toolName: "write_file",
        }
      ),
    ]))

    expect(chat.permissionItems?.[0]).toMatchObject({
      target: "mounts/docs/README.md",
      details: [
        { label: "路径", value: "mounts/docs/README.md", code: true },
        { label: "访问模式", value: "write" },
        { label: "目标类型", value: "file" },
        { label: "审批原因", value: "write_file" },
      ],
    })
  })

  it("labels OpenCode external permission requests with provider source and kind", () => {
    const items = project([
      event(
        "permission.requested",
        {
          requestId: "permission_opencode_edit",
          reason: "OpenCode wants to edit src/index.ts",
          data: {
            externalProvider: "opencode",
            providerSessionId: "ses_opencode",
            providerPermissionId: "perm_edit",
            permissionKind: "edit",
            permissionType: "file_write",
            patterns: ["src/index.ts"],
          },
        },
        {
          toolCallId: "opencode:call_edit",
          toolName: "edit",
        }
      ),
    ])

    const chat = chatMessage(items)
    expect(chat.permissionItems).toHaveLength(1)
    expect(chat.permissionItems?.[0]).toMatchObject({
      title: "OpenCode 权限请求：edit",
      reason: "OpenCode wants to edit src/index.ts",
      externalProvider: "opencode",
      target: "src/index.ts",
    })
  })
})
