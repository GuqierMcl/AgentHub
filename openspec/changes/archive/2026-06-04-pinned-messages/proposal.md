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
