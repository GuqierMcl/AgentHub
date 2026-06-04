# Comet Design Handoff

- Change: pinned-messages
- Phase: design
- Mode: compact
- Context hash: f3e10cfc2b9e5a027aa17dfef9f5dd1a0118b7eb419ecc4e358ff3db22f95186

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/pinned-messages/proposal.md

- Source: openspec/changes/pinned-messages/proposal.md
- Lines: 1-28
- SHA256: 5fc7f4337b59645a0e5438f1e19d71e839179f60ac7516ba2aef3f0b77febefd

```md
# 置顶消息（Pinned Messages）

## 问题

在长对话中，用户的关键指令、约束条件或上下文会随着对话轮次增加被推到 history 尾部，甚至超出 Agent 的上下文窗口（当前限制最近 100 条消息）。Agent 可能"遗忘"用户早期的重要指示，导致回复偏离预期。

Product Spec (`docs/product/PRODUCT_SPEC.md`) 已明确将此列为能力："用户可以 pin 关键消息，作为长期上下文输入 Agent"。数据层（`MessagePin` 表）和 Repository 层（`message-pin.repo.ts`）已就绪，但缺少 API 端点和 Agent 上下文注入逻辑。

## 目标

- 用户可以在任意消息上执行"置顶"操作
- 被置顶的消息始终出现在 Agent 的 system prompt 中，不受对话轮次影响
- Agent 每次回复时都能"醒目地"看到所有 pinned 消息
- 用户可以查看、管理（取消置顶、编辑备注）已置顶的消息

## 范围

1. **后端 API**：Pin 的 CRUD 端点（创建、查询、删除、更新）
2. **上下文注入**：在 `RunPersistenceService.sendMessage()` 中查询 pinned 消息并注入 Agent system prompt
3. **前端 UI**：消息操作菜单增加"置顶"、置顶消息展示与管理界面
4. **约束**：单会话最多 10 条置顶消息，避免 token 溢出

## 非目标

- 群聊中 per-agent 可见性差异化（后续迭代）
- Pin 的分类/标签系统
- Pin 跨会话共享
- Pin 的排序拖拽交互（已有 `sortOrder` 字段，但 UI 排序交互为 P2）
```

## openspec/changes/pinned-messages/design.md

- Source: openspec/changes/pinned-messages/design.md
- Lines: 1-72
- SHA256: eead32d442ead587bc3800c6d714d0a90e85b55c058519044996895718c8ad13

```md
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
```

## openspec/changes/pinned-messages/tasks.md

- Source: openspec/changes/pinned-messages/tasks.md
- Lines: 1-27
- SHA256: bf6efed47110d68b847c6e112f80074a266f6c274e03906edcfab42b8036c2f5

```md
# 置顶消息 — 任务清单

## 后端 API

- [ ] **T1**: 新增 Pin CRUD 路由 — `POST /api/conversations/:id/pins`、`GET /api/conversations/:id/pins`、`DELETE /api/pins/:pinId`、`PATCH /api/pins/:pinId`
- [ ] **T2**: 补充 repository 方法 — 如需要，添加 `getMessagePartsByIds` 或类似查询以获取 pinned 消息的完整内容
- [ ] **T3**: Pin 数量限制 — 单会话最多 10 条，创建时校验

## 上下文注入

- [ ] **T4**: 在 `RunPersistenceService.sendMessage()` 中查询 pinned 消息
- [ ] **T5**: 构建 pinned messages block（XML 格式），注入 system prompt
- [ ] **T6**: 处理长消息截断（单条 > 2000 字符时截断并标注）
- [ ] **T7**: 去重处理 — 确保 pinned 消息在 history 和 system prompt 中不产生混淆

## 前端 UI

- [ ] **T8**: `MessageItem` 组件增加"置顶"操作（右键菜单或 hover 按钮）
- [ ] **T9**: `PinnedMessagesBar` 组件 — 在聊天区域顶部展示当前会话的置顶消息列表
- [ ] **T10**: Pin API 调用封装 — `web/src/features/workbench/api/messages.ts` 中新增 pin 相关函数
- [ ] **T11**: 取消置顶交互 — 点击 pinned message 可取消置顶或编辑备注

## 验证

- [ ] **T12**: 后端单测 — pin CRUD + 数量限制 + 截断逻辑
- [ ] **T13**: 集成验证 — 置顶消息确实出现在 agent system prompt 中（通过日志或 run input 快照验证）
- [ ] **T14**: 前端交互验证 — 置顶/取消置顶流程完整可用
```

