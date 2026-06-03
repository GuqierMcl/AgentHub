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
