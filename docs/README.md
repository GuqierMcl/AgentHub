# AgentHub 文档

本目录是 AgentHub 产品设计、技术设计、接口契约、交付说明和 AI 协作记录的事实来源。

AI 智能体在每一轮开发前，必须先查阅与任务相关的文档。如果实现会改变行为、架构、接口契约、权限模型、编排逻辑或产物协议，必须在同一轮工作中同步更新对应文档。

## 推荐阅读路径

1. `delivery/README.md`：交付总览、创新点和答辩阅读路径。
2. `product/PRODUCT_SPEC.md`：当前产品范围、优先级和交付边界。
3. `architecture/ARCHITECTURE.md`：Web、HubServer、Agent Runtime 的整体边界。
4. `contracts/AGENT_RUNTIME_API_CONTRACTS.md`：Runtime API、Sidecar 调用和事件载荷。
5. `roadmap/README.md`：已完成路线图归档索引。
6. `backlog/README.md`：交付后增强项。

## 文档职责

| 目录 | 职责 |
| --- | --- |
| `delivery/` | 交付总览、答辩阅读路径、成果和创新点 |
| `product/` | 产品规格、课题简报、功能优先级和交付边界 |
| `architecture/` | 模块职责、进程边界、运行机制、生产分发和安全模型 |
| `contracts/` | API、SSE、RunEvent、请求/响应和稳定事件契约 |
| `external_agents/` | Claude Code、Codex、OpenCode 等外部 Agent Adapter 设计 |
| `guides/` | 面向实现者的操作指南和清单 |
| `reference/` | 第三方框架或通用技术约定 |
| `adr/` | 长期架构决策记录 |
| `roadmap/` | 长复杂模块路线图；本次交付前已完成路线图统一归档到 `roadmap/completed/` |
| `backlog/` | 从已完成路线图中提取出来的交付后增强项 |
| `superpowers/` | AI 协作产生的设计、计划和验证记录 |

## 文档索引

| 文档 | 用途 |
| --- | --- |
| `delivery/README.md` | 交付总览、成果状态、创新点和答辩建议 |
| `product/PRODUCT_SPEC.md` | 产品范围、优先级、核心 IM 体验和交付边界 |
| `product/ASSIGNMENT_BRIEF.md` | 原始课题要求、考察要点和交付物要求 |
| `architecture/ARCHITECTURE.md` | 整体架构与进程边界 |
| `architecture/DATA_MODEL.md` | 领域数据模型，基于 AI SDK 的 UIMessage 最佳实践 |
| `architecture/WEB.md` | 前端架构与 UI 职责 |
| `architecture/HUB_SERVER.md` | API Server / Hub Server 架构 |
| `architecture/AGENT_RUNTIME.md` | Agent Runtime、编排、适配器、权限与沙箱 |
| `architecture/AGENT_RUNTIME_BACKEND.md` | Workspace Backend、文件系统沙箱与外部目录审批设计 |
| `architecture/AGENT_ARCHITECTURE.md` | 主智能体、子智能体、Orchestrator、委派关系与外部智能体接入设计 |
| `architecture/AGENT_TOOLS.md` | 工具体系、`run_task`、工具可见性、审批与事件流设计 |
| `architecture/BASH_TOOL.md` | Runtime `bash` 工具、命令规则、审批和事件语义 |
| `architecture/BUN_RUNTIME_PACKAGING.md` | Bun `--compile`、命令行参数解析和生产二进制约束 |
| `architecture/AGENTHUB_CLI.md` | AgentHub CLI 生产入口、参数、发行目录解析和 HubServer 启动职责 |
| `architecture/PROVIDER_MODEL_DESIGN.md` | Provider/Model 配置管理、models.dev 目录、缓存和用户配置设计 |
| `architecture/PRODUCTION_DISTRIBUTION.md` | 生产构建、扁平发行包、CLI/Desktop 入口、Web 托管与 Runtime Sidecar 约束 |
| `architecture/HUB_GLOBAL_EVENTS.md` | HubServer 全局产品状态事件 |
| `architecture/RUN_EVENT_SCHEMA_AND_PROJECTION.md` | RunEvent 结构与产品投影规则 |
| `architecture/RUN_PERSISTENCE_AND_STREAMING.md` | Run 持久化、事件流和恢复机制 |
| `external_agents/EXTERNAL_AGENT_ADAPTERS.md` | 外部智能体公共边界、Session scope、上下文、权限和事件设计 |
| `external_agents/OPENCODE_ADAPTER.md` | OpenCode Adapter 专属设计 |
| `external_agents/CLAUDE_CODE_ADAPTER.md` | Claude Code Adapter 专属设计 |
| `external_agents/CODEX_ADAPTER.md` | Codex Adapter 专属设计 |
| `contracts/AGENT_RUNTIME_API_CONTRACTS.md` | Agent Runtime API 契约、Sidecar 调用与事件载荷 |
| `contracts/RUNTIME_SSE_EVENTS.md` | Runtime Run SSE 事件契约、模型流透传与 reasoning 事件 |
| `guides/ADDING_RUNTIME_TOOLS.md` | Runtime 工具添加步骤、授权、审批、事件与测试清单 |
| `reference/HONO.md` | Hub Server 与 Agent Runtime 共享的 Hono 使用约定 |
| `roadmap/README.md` | 路线图使用规则和已完成路线图索引 |
| `backlog/AGENT_SIDE_CAPABILITY_BACKLOG.md` | Agent 侧交付后增强储备 |
| `superpowers/README.md` | AI 协作设计、计划和验证记录索引 |
| `adr/README.md` | ADR 记录规则 |

## 更新规则

- 文档要保持简洁、可执行，面向后续开发者、评审者和 AI 智能体使用。
- 优先更新已有文档；只有当现有文档无法承载新决策时，才创建新文档。
- 长期影响架构、模块边界、运行时行为或关键取舍的决策，应写入 ADR。
- 路线图只记录明确实施周期内的阶段推进；已完成路线图进入 `roadmap/completed/`，后续增强进入 `backlog/`。
- 如果文档与代码不一致，不能擅自选择其一；需要说明冲突、影响，并确认是更新文档还是调整实现。
