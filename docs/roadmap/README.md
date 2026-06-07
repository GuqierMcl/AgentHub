# 路线图

本目录用于记录长复杂模块的实施路径、阶段拆分和跨会话推进记录。交付前已完成的路线图统一归档到 `docs/roadmap/completed/`。

> 当前交付状态：本目录没有未完结路线图。后续增强统一进入 `docs/backlog/`，只有重新进入实施周期时才创建新的路线图。

## 什么时候使用

当一个模块满足以下任一情况时，应建立对应的路线图文件：

- 实现周期长，往往要分多轮完成。
- 涉及多个目录、多个服务或多层边界。
- 需要在不同聊天回合之间持续推进。
- 需要把需求拆成可验收的阶段。
- 容易因为上下文丢失而偏离原设计。

## 当前索引

| 状态 | 文档 | 说明 |
| --- | --- | --- |
| 已完结 | `completed/initial-implementation-plan.md` | 早期 AgentHub 可行实现计划，已作为历史实施路径归档 |
| 已完结 | `completed/runs-chat-integration.md` | Runtime RunEvent 到 HubServer / Web 聊天产品链路 |
| 已完结 | `completed/agent-runtime-agent-architecture.md` | Agent Runtime 智能体架构、预设智能体、工具、Orchestrator 与外部 Adapter 骨架 |
| 已完结 | `completed/opencode-adapter-implementation.md` | OpenCode Adapter V1、Workspace Diff、Event Stream、Tool Timeline 和 Permission Bridge |
| 已完结 | `completed/claude-code-adapter-implementation.md` | Claude Code Adapter V1 设计、接入和 smoke 策略 |
| 已完结 | `completed/codex-adapter-implementation.md` | Codex Adapter SDK-first 接入和生产硬化路线 |
| 已完结 | `completed/agenthub-native-patch-review.md` | AgentHub 原生 Patch Review / Workspace Change Review 路线 |

交付后增强项见 `docs/backlog/AGENT_SIDE_CAPABILITY_BACKLOG.md`。

## 建议结构

每个路线图文件建议包含以下内容：

- 模块名称。
- 目标与完成标准。
- 依赖文档。
- 范围说明。
- 阶段拆分。
- 当前进度。
- 已完成事项。
- 交付后增强项。
- 风险与待确认点。
- 最近一次更新记录。

## 更新规则

- 路线图是长期任务的执行主线，应尽量保持最新。
- 每轮涉及该模块的实现后，都要同步更新路线图。
- 如果实现方向发生变化，先更新路线图，再继续编码。
- 路线图内容应具体到可执行任务，不要只写抽象口号。
- 路线图不是 ADR；路线图关注“怎么做”，ADR 关注“为什么这样定”。
- 路线图完结后移入 `completed/`，不再追加新阶段；新增想法进入 `docs/backlog/`。

## 与其他文档的关系

- `docs/architecture/` 记录架构与边界。
- `docs/contracts/` 记录接口与事件契约。
- `docs/roadmap/` 记录复杂模块的实施路径与阶段推进。
- `docs/backlog/` 记录交付后增强项。
- `docs/adr/` 记录长期架构决策。

## 模板

新建复杂模块路线图时，可直接复制 `docs/roadmap/TEMPLATE.md`。
