# AgentHub 文档

本目录是 AgentHub 产品设计与技术设计的事实来源。

AI 智能体在每一轮开发前，必须先查阅与任务相关的文档。如果实现会改变行为、架构、接口契约、权限模型、编排逻辑或产物协议，必须在同一轮工作中同步更新对应文档。

## 文档索引

| 文档 | 用途 |
| --- | --- |
| `product/PRODUCT_SPEC.md` | 产品范围、优先级与核心 IM 体验 |
| `architecture/ARCHITECTURE.md` | 整体架构与进程边界 |
| `architecture/DATA_MODEL.md` | 领域数据模型，基于 AI SDK 的 UIMessage 最佳实践 |
| `architecture/WEB.md` | 前端架构与 UI 职责 |
| `architecture/HUB_SERVER.md` | API Server / Hub Server 架构 |
| `architecture/AGENT_RUNTIME.md` | Agent Runtime、编排、适配器、权限与沙箱 |
| `architecture/AGENT_RUNTIME_BACKEND.md` | Agent Runtime 的 Workspace Backend、文件系统沙箱与外部目录审批设计 |
| `architecture/AGENT_ARCHITECTURE.md` | 主智能体、子智能体、Orchestrator、委派关系与外部智能体接入设计 |
| `architecture/AGENT_TOOLS.md` | 工具体系、`run_task`、工具可见性、审批与事件流设计 |
| `contracts/API_CONTRACTS.md` | 跨进程 API 契约与事件载荷 |
| `reference/HONO.md` | Hub Server 与 Agent Runtime 共享的 Hono 使用约定 |
| `roadmap/` | 长复杂模块的实现路线图与分阶段推进记录 |
| `adr/` | 架构决策记录 |

## 更新规则

- 文档要保持简洁、可执行，面向后续开发者和 AI 智能体使用。
- 优先更新已有文档；只有当现有文档无法承载新决策时，才创建新文档。
- 长期影响架构、模块边界、运行时行为或关键取舍的决策，应写入 ADR。
- 如果文档与代码不一致，不能擅自选择其一；需要说明冲突、影响，并确认是更新文档还是调整实现。
