# 置顶消息 — 高层设计

## 架构决策

### 1. 注入位置：System Prompt（而非 History 头部）

**决策**：将 pinned 消息注入 Agent 的 system prompt，而非作为 history 消息放在最前面。

**理由**：
- System prompt 是 LLM 上下文中权重最高的位置，不会被 history 截断逻辑影响
- History 头部注入方案中，如果 pinned 消息恰好在 history 窗口内，会产生重复
- System prompt 注入对所有 adapter（OpenCode、Claude Code、Codex 等）通用，无需逐个适配
- 用户诉求是"醒目接收"，system prompt 的 `<pinned_messages>` 标记比混在 history 中更显眼

### 2. 注入格式

```
<📌 置顶消息 (Pinned Messages)>
以下是用户标记为置顶的关键消息，请在每次回复时优先参考：

[1] (pinned by user, 2026-06-04)
> 用户置顶的原始消息内容...

[2] (pinned by user, 2026-06-04, note: "重要约束")
> 用户置顶的原始消息内容...

</📌 置顶消息>
```

### 3. 数据流

```
用户点击"置顶" → POST /api/conversations/:id/pins
  → message-pin.repo.createMessagePin()
  → 返回 pin 对象

用户发送消息 → RunPersistenceService.sendMessage()
  → listMessagePinsByConversation(conversationId)
  → getMessagesByIds(pinnedMessageIds)  // 获取原始消息内容
  → 构建 pinned messages block
  → 注入 system prompt（buildSystemPrompt 中追加 pinned section）
  → POST /runtime/runs（agent-runtime）

Agent 回复 → 历史消息中正常显示
```

### 4. 去重策略

Pinned 消息注入 system prompt 后，在 history 中仍可能存在。为避免 LLM 收到重复内容：
- **不从 history 中移除 pinned 消息**（保持历史完整性）
- system prompt 中使用明显的 XML 标记包裹，LLM 能识别这是"强调"而非"新内容"
- 这与 Claude/GPT 的 system prompt best practice 一致

### 5. 约束

| 约束 | 值 | 理由 |
|---|---|---|
| 单会话最大 pin 数 | 10 | 避免 system prompt token 溢出 |
| 单条 pin 最大字符 | 2000 | 超长消息截断，避免注入过长内容 |
| sortOrder 默认值 | 0 | 创建时自动分配，后续可手动调整 |

## 关键文件

| 文件 | 改动类型 |
|---|---|
| `hub-server/src/routers/messages.ts` | 新增 pin CRUD 端点 |
| `hub-server/src/repositories/message-pin.repo.ts` | 已有，可能需要补充 getMessagesByIds 查询 |
| `hub-server/src/services/run-persistence.service.ts` | 核心改动：sendMessage 中注入 pinned 到 system prompt |
| `agent-runtime/src/runtime/ai-sdk-executor.ts` | system prompt 组装逻辑（如 pinned 在 hub-server 侧注入则无需改动） |
| `web/src/features/workbench/components/MessageItem.tsx` | 消息操作菜单增加"置顶" |
| `web/src/features/workbench/api/messages.ts` | 新增 pin API 调用 |
| 新增：`web/src/features/workbench/components/PinnedMessagesBar.tsx` | 置顶消息展示组件 |
