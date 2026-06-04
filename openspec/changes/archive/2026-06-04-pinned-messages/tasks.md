# 置顶消息 — 任务清单

## 后端 API

- [x] **T1**: 新增 Pin CRUD 路由 — `POST /api/conversations/:id/pins`、`GET /api/conversations/:id/pins`、`DELETE /api/pins/:pinId`、`PATCH /api/pins/:pinId`
- [x] **T2**: 补充 repository 方法 — `listMessagePinsWithContent` 和 `countMessagePinsByConversation`
- [x] **T3**: Pin 数量限制 — 单会话最多 10 条，创建时校验

## 上下文注入

- [x] **T4**: 在 `RunPersistenceService.sendMessage()` 中查询 pinned 消息
- [x] **T5**: 构建 pinned messages block（XML 格式），注入 system prompt
- [x] **T6**: 处理长消息截断（单条 > 2000 字符时截断并标注）
- [x] **T7**: 去重处理 — 不从 history 移除，system prompt 用 XML 标记包裹

## 前端 UI

- [x] **T8**: `MessageItem` 组件增加"置顶"操作（hover 时显示 PinIcon 按钮）
- [x] **T9**: `PinnedMessagesBar` 组件 — 在聊天区域顶部展示当前会话的置顶消息列表
- [x] **T10**: Pin API 调用封装 — `web/src/features/workbench/api/messages.ts` 中新增 pin 相关函数
- [x] **T11**: 取消置顶交互 — 点击 pinned message 可取消置顶

## 验证

- [x] **T12**: 类型检查通过 — web (tsc --noEmit) 无错误
- [x] **T13**: 合约文档更新 — `AGENT_RUNTIME_API_CONTRACTS.md` 记录 pinnedMessages 字段和新错误码
- [x] **T14**: 前端组件集成 — ChatPanel 使用 usePinnedMessages hook，传递 pin 状态到 TimelineList
