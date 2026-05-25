# Runtime 工具添加指南

本文档约束 Agent Runtime 新增工具的必要步骤，避免出现工具已实现但未注册、未授权、未进入 API 契约或绕过审批边界的问题。

## 1. 先确认工具边界

新增工具前必须先明确：

- 工具名，使用稳定的 `snake_case`。
- 工具用途和模型可见描述。
- 输入 schema 和结构化输出。
- 风险等级：`low`、`medium`、`high`。
- 是否需要审批，以及审批触发条件。
- 是否是 `internal` 工具。
- 是否允许用户自定义智能体配置。

默认规则：

- 新工具默认不对用户自定义智能体开放。
- 只有加入 `USER_AGENT_ALLOWED_TOOLS`，并补充 authoring options metadata 后，才会出现在创建/编辑自定义智能体表单中。
- 高风险工具不能直接加入用户可配置工具白名单。

## 2. 实现 Runtime Tool

在 `agent-runtime/src/runtime/tools/` 中添加或扩展工具实现：

- 定义 Zod 输入 schema。
- 返回统一 `ToolExecutionResult`：`status`、`summary`、`data`、`error`。
- 不在 `ToolDefinition` 中写 agent 白名单。
- 如工具只应由 Orchestrator 使用，设置 `internal: true`，并只把工具名加入 `orchestrator.allowedTools`。
- 工具执行过程必须通过 `RuntimeToolRegistry.executeTool()` 进入，以便统一产生 `tool.started`、`tool.completed`、`tool.failed`。

如果工具会访问文件系统、网络、shell、部署或外部服务，还必须先经过对应 service/backend，不允许在工具中绕开 Runtime 权限边界。

## 3. 注册和授权

新增工具后至少检查：

- 在 Runtime 初始化处注册工具。
- 在需要使用该工具的预设智能体 `allowedTools` 中显式加入工具名。
- 用户自定义智能体是否允许配置该工具。

用户可配置工具的唯一代码白名单是：

```ts
USER_AGENT_ALLOWED_TOOLS
```

该常量表示“用户自定义智能体可配置的非 internal 安全工具集合”，不是 Runtime 全量工具列表。

## 4. Authoring Options

如果工具允许用户自定义智能体选择，必须同步更新：

- `USER_AGENT_ALLOWED_TOOLS`
- `UserAgentAllowedToolSchema`
- `GET /runtime/agents/authoring-options` 的 `tools` metadata
- `docs/contracts/API_CONTRACTS.md`

工具 metadata 至少包含：

- `id`
- `name`
- `description`
- `category`
- `riskLevel`
- `requiresApproval`
- `permissionEffect`

## 5. 权限和审批

工具权限需要同时考虑：

- `agent.allowedTools`：工具是否对当前智能体可见。
- `permissionPolicy`：智能体是否具备对应能力。
- `requiresApproval`：是否需要用户审批。
- Workspace Backend 或外部 Adapter 的实际访问边界。

文件、部署、shell、网络类工具必须有明确审批路径。沙箱外文件访问必须通过 Workspace Backend 的外部访问授权流程。

## 6. 事件和契约

新增工具应复用现有工具事件：

- `tool.started`
- `tool.completed`
- `tool.failed`
- `permission.requested`

如果工具引入新的业务事件或特殊 payload，必须同步更新 `docs/contracts/API_CONTRACTS.md`。

## 7. 测试清单

新增工具至少补充以下测试：

- 输入 schema 校验失败返回 `TOOL_INVALID_INPUT`。
- 未加入 `agent.allowedTools` 时返回 `TOOL_NOT_ALLOWED`。
- 加入 `agent.allowedTools` 后可见且可执行。
- 如是 `internal` 工具，普通 AI SDK 注入默认不可见。
- 如需要审批，能产生 `permission.requested`。
- 工具成功和失败都会产生终态工具事件。

变更完成后运行：

```bash
cd agent-runtime
bunx tsc --noEmit
bun test
```
