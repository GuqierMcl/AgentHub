---
comet_change: pinned-messages
role: technical-design
canonical_spec: openspec
archived-with: 2026-06-04-pinned-messages
status: final
---

# 置顶消息 — 技术设计文档

## 概述

用户可以在对话中 pin 关键消息，使其内容始终注入 Agent 的 system prompt，确保无论对话轮次多长，Agent 都能醒目接收到置顶消息。

## 架构

### 数据流

```
用户 pin 消息
  → POST /api/conversations/:id/pins { messageId, note? }
  → message-pin.repo.createMessagePin()
  → 返回 MessagePin 对象

用户发送消息
  → POST /api/conversations/:id/messages/send
  → RunPersistenceService.sendMessage()
    → listMessagePinsWithContent(conversationId)
    → 构建 PinnedMessage[] (截断、排序)
    → buildRuntimeRunInput(..., pinnedMessages)
    → POST /runtime/runs (agent-runtime)

Agent Runtime 处理
  → RunInputSchema 解析 pinnedMessages
  → AI SDK / Orchestrator system prompt builder 追加 pinned messages section
  → streamText({ system, messages, ... })
```

### API 合约变更

#### RuntimeRunInput 扩展

在 `RunInputSchema` 中新增可选字段：

```ts
const PinnedMessageSchema = z.object({
  id: z.string(),              // pin ID
  messageId: z.string(),       // 原始消息 ID
  content: z.string(),         // 消息文本内容
  note: z.string().nullable().optional(),  // 用户备注
  pinnedAt: z.string(),        // 置顶时间 ISO
  sortOrder: z.number(),       // 排序权重
})

// RunInputSchema 新增:
pinnedMessages: z.array(PinnedMessageSchema).optional().default([]),
```

此字段为可选，不影响现有 runtime 兼容性。

#### Pin CRUD API

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/conversations/:id/pins` | POST | 创建 pin，body: `{ messageId, note?, sortOrder? }` |
| `/api/conversations/:id/pins` | GET | 列出该会话所有 pins，返回 `messageContent` 供置顶栏展示 |
| `/api/pins/:pinId` | DELETE | 删除 pin |
| `/api/pins/:pinId` | PATCH | 更新 pin，body: `{ note?, sortOrder? }` |

约束：
- 单会话最多 10 条 pin
- 创建时校验消息存在且属于该会话
- 删除时 cascade 清理（已有 Prisma 配置）

### System Prompt 注入

在 `agent-runtime/src/runtime/ai-sdk-executor.ts` 的 `buildSystemPrompt()` 中：

```ts
if (context.input.pinnedMessages && context.input.pinnedMessages.length > 0) {
  const pinnedBlock = [
    '<📌 置顶消息 (Pinned Messages)>',
    '以下是用户标记为置顶的关键消息，请在每次回复时优先参考：',
    '',
    ...context.input.pinnedMessages.map((msg, i) => {
      const note = msg.note ? `, note: "${msg.note}"` : ''
      return `[${i + 1}] (pinned at ${msg.pinnedAt}${note})\n> ${msg.content}`
    }),
    '',
    '</📌 置顶消息>',
  ].join('\n')
  systemNotes.push(pinnedBlock)
}
```

### 内容获取

新增 repository 方法获取 pinned 消息的文本内容：

```ts
// hub-server/src/repositories/message-pin.repo.ts
export async function listMessagePinsWithContent(conversationId: string) {
  const db = getPrismaClient()
  return db.messagePin.findMany({
    where: { conversationId },
    include: {
      message: {
        include: {
          parts: {
            where: { type: 'text' },
            select: { text: true },
            take: 1,
          },
        },
      },
    },
    orderBy: { sortOrder: 'asc' },
  })
}
```

### 截断策略

```ts
const MAX_PIN_CONTENT_LENGTH = 2000
const MAX_PINS_PER_CONVERSATION = 10

function truncatePinContent(content: string): string {
  if (content.length <= MAX_PIN_CONTENT_LENGTH) return content
  return content.slice(0, MAX_PIN_CONTENT_LENGTH) + '\n...[截断]'
}
```

### 去重处理

Pinned 消息同时存在于 system prompt 和 history 中，不从 history 中移除：
- 保持历史完整性
- System prompt 使用 XML 标记，LLM 识别为"强调"语义
- 与 Claude/GPT system prompt best practice 一致

## 关键文件改动

| 文件 | 改动 |
|---|---|
| `hub-server/src/routers/messages.ts` | 新增 pin CRUD 路由 |
| `hub-server/src/repositories/message-pin.repo.ts` | 新增 `listMessagePinsWithContent()` |
| `hub-server/src/services/run-persistence.service.ts` | `sendMessage()` 中查询并传递 pinned data |
| `agent-runtime/src/runtime/types.ts` | `RunInputSchema` 新增 `pinnedMessages` 字段 |
| `agent-runtime/src/runtime/ai-sdk-executor.ts` | `buildSystemPrompt()` 注入 pinned block |
| `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md` | 记录合约变更 |
| `web/src/features/workbench/components/MessageItem.tsx` | 消息操作增加"置顶" |
| `web/src/features/workbench/api/messages.ts` | 新增 pin API 调用 |
| 新增 `web/src/features/workbench/components/PinnedMessagesBar.tsx` | 置顶消息展示组件 |

## 测试策略

### 后端单测
- Pin CRUD：创建、查询、删除、更新
- 数量限制：超过 10 条返回错误
- 截断逻辑：超长内容正确截断
- 内容获取：join 查询返回正确的消息文本

### 集成验证
- 发送消息后检查 `run.inputJson` 包含 `pinnedMessages`
- 检查 agent-runtime 的 system prompt 日志包含 pinned block

### 前端验证
- 消息 hover 显示 pin 按钮
- 点击 pin 后消息标记为已置顶
- PinnedMessagesBar 正确展示置顶列表
- 取消置顶后 bar 更新
