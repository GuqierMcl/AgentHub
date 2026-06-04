---
change: pinned-messages
design-doc: docs/superpowers/specs/2026-06-04-pinned-messages-design.md
base-ref: dde5b5035c5bed56904f32c1bfbb831ea1258b70
archived-with: 2026-06-04-pinned-messages
---

# 置顶消息 — 实施计划

## 阶段 1：后端 API（T1-T3）

### T1: Pin CRUD 路由
- 文件：`hub-server/src/routers/messages.ts`（追加）或新建 `hub-server/src/routers/message-pins.ts`
- 实现 4 个端点：
  - `POST /api/conversations/:id/pins` — 创建 pin
  - `GET /api/conversations/:id/pins` — 列出 pins
  - `DELETE /api/pins/:pinId` — 删除 pin
  - `PATCH /api/pins/:pinId` — 更新 note/sortOrder
- 输入校验用 zod schema
- 注册到主 router

### T2: Repository 补充
- 文件：`hub-server/src/repositories/message-pin.repo.ts`
- 新增 `listMessagePinsWithContent(conversationId)` — join Message + MessagePart 获取文本内容
- 新增 `countMessagePinsByConversation(conversationId)` — 用于数量限制校验

### T3: 数量限制
- 在 createMessagePin 前检查 count，超过 10 条返回 `PIN_LIMIT_EXCEEDED` 错误
- 错误码：400

## 阶段 2：Runtime 合约扩展（T4-T7）

### T4: RunInputSchema 扩展
- 文件：`agent-runtime/src/runtime/types.ts`
- 新增 `PinnedMessageSchema`
- 在 `RunInputSchema` 中添加 `pinnedMessages: z.array(PinnedMessageSchema).optional().default([])`

### T5: sendMessage 查询 pinned
- 文件：`hub-server/src/services/run-persistence.service.ts`
- 在 `sendMessage()` 中调用 `listMessagePinsWithContent()`
- 构建 `PinnedMessage[]` 数组，截断超长内容
- 传入 `buildRuntimeRunInput()`

### T6: buildRuntimeRunInput 传递 pinned
- 文件：`hub-server/src/services/run-persistence.service.ts`
- `buildRuntimeRunInput()` 新增 `pinnedMessages` 参数
- 写入返回对象

### T7: buildSystemPrompt 注入
- 文件：`agent-runtime/src/runtime/ai-sdk-executor.ts`
- 在 `buildSystemPrompt()` 中追加 pinned messages XML block
- 格式：`<📌 置顶消息>` 包裹

## 阶段 3：前端 UI（T8-T11）

### T8: 消息置顶操作
- 文件：`web/src/features/workbench/components/MessageItem.tsx`
- hover 时显示 📌 按钮
- 点击调用 pin API

### T9: Pin API 封装
- 文件：`web/src/features/workbench/api/messages.ts`
- 新增 `createPin()`, `listPins()`, `deletePin()`, `updatePin()` 函数

### T10: PinnedMessagesBar 组件
- 新建：`web/src/features/workbench/components/PinnedMessagesBar.tsx`
- 在聊天区域顶部展示置顶消息列表
- 支持取消置顶

### T11: 集成到聊天界面
- 文件：聊天相关组件
- 将 PinnedMessagesBar 放置在消息列表上方
- 加载会话时同时加载 pins

## 阶段 4：验证（T12-T14）

### T12: 后端单测
- Pin CRUD 单测
- 数量限制测试
- 截断逻辑测试

### T13: 集成验证
- 发送消息后检查 run.inputJson 包含 pinnedMessages
- 验证 agent system prompt 日志

### T14: 前端验证
- 置顶/取消置顶流程
- PinnedMessagesBar 展示

## 合约文档更新
- `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md` — 记录 pinnedMessages 字段
