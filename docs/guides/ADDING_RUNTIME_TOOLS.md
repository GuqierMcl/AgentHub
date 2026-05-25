# Runtime 工具添加指南

本文档约束 Agent Runtime 新增工具的必要步骤，避免出现工具已实现但未注册、未授权、未进入 API 契约或绕过审批边界的问题。

## 1. 先确认工具边界

新增工具前必须先明确：

- 工具名，使用稳定的 `snake_case`。
- 工具用途和模型可见描述。
- 输入 schema 和结构化输出。
- 风险等级：`low`、`medium`、`high`。
- 审批策略：`never`、`contextual` 或 `always`，以及 contextual 触发条件。
- 运行所需的 `requiredPermissions`。
- 是否是 `internal` 工具。
- 是否允许用户自定义智能体配置。

默认规则：

- 新工具默认不对用户自定义智能体开放。
- 只有工具定义声明 `configurableByUserAgent: true` 并提供 authoring metadata 后，才会从 Tool Catalog 投影到创建/编辑自定义智能体表单中。
- 高风险工具不应设置为用户可配置，除非已完成明确的权限和审批设计。

## 2. 实现 Runtime Tool

在 `agent-runtime/src/runtime/tools/` 中添加或扩展工具实现：

- 定义 Zod 输入 schema。
- 返回统一 `ToolExecutionResult`：`status`、`summary`、`data`、`error`。
- 在工具定义中声明 `displayName`、`category`、`riskLevel`、`requiredPermissions`、`approvalPolicy` 与 `configurableByUserAgent`。
- 不在 `ToolDefinition` 中写 agent 白名单。
- 如工具只应由 Orchestrator 使用，设置 `internal: true`，并只把工具名加入 `orchestrator.allowedTools`。
- 工具执行过程必须通过 `RuntimeToolRegistry.executeTool()` 进入，以便统一产生 `tool.started`、`tool.completed`、`tool.failed`。

如果工具会访问文件系统、网络、shell、部署或外部服务，还必须先经过对应 service/backend，不允许在工具中绕开 Runtime 权限边界。

## 3. 注册和授权

新增工具后至少检查：

- 在 Runtime 初始化处注册工具。
- 在需要使用该工具的预设智能体 `allowedTools` 中显式加入工具名。
- 用户自定义智能体是否允许配置该工具。

Tool Catalog 由注册的 `ToolDefinition` 组成，是工具风险、权限要求、审批策略和 authoring metadata 的唯一代码事实来源。不要在 router、CRUD 校验或其他模块中重建工具清单。

## 4. Authoring Options

如果工具允许用户自定义智能体选择，必须在自身定义中设置 `configurableByUserAgent: true` 与展示 metadata，并同步更新 `docs/contracts/API_CONTRACTS.md` 和测试。`GET /runtime/agents/authoring-options` 会自动从 Tool Catalog 返回该工具。

工具 metadata 至少包含：

- `id`
- `name`
- `description`
- `category`
- `riskLevel`
- `approvalPolicy`
- `requiredPermissions`

## 5. 权限和审批

工具权限需要同时考虑：

- `agent.allowedTools`：工具是否对当前智能体可见。
- `permissionPolicy`：当前智能体是否具备工具 `requiredPermissions` 要求的能力上限。
- `approvalPolicy`：工具是否始终审批、按上下文审批或无需审批。
- Workspace Backend 或外部 Adapter 的实际访问边界。

审批不写入 agent 配置。文件、部署、shell、网络类工具必须有明确审批路径；沙箱外文件访问必须通过 Workspace Backend 的外部访问授权流程，并由 `RuntimePermissionService` 在同一 Run 中等待和续跑。

后续实现 `write_file` / `edit_file` 时，必须声明 `requiredPermissions: { filesystem: "write" }` 并使用强制审批策略；外部写入还必须先补 write grant。

## 6. 事件和契约

新增工具应复用现有工具事件：

- `tool.started`
- `tool.completed`
- `tool.failed`
- `permission.requested`
- `permission.approved`
- `permission.denied`
- `permission.cancelled`

如果工具引入新的业务事件或特殊 payload，必须同步更新 `docs/contracts/API_CONTRACTS.md`。

## 7. 测试清单

新增工具至少补充以下测试：

- 输入 schema 校验失败返回 `TOOL_INVALID_INPUT`。
- 未加入 `agent.allowedTools` 时返回 `TOOL_NOT_ALLOWED`。
- 加入 `agent.allowedTools` 后可见且可执行。
- `permissionPolicy` 低于工具 `requiredPermissions` 时返回 `TOOL_PERMISSION_DENIED`。
- 如是 `internal` 工具，普通 AI SDK 注入默认不可见。
- 如需要审批，能产生 `permission.requested`，且在决定前不产生 `tool.started`。
- 批准、拒绝、取消路径能产生对应权限终态事件，并在同一个 Run 中正确续跑或终止。
- 工具成功和失败都会产生终态工具事件。

变更完成后运行：

```bash
cd agent-runtime
bunx tsc --noEmit
bun test
```
