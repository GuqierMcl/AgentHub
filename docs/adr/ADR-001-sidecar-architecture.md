# ADR-001: agent-runtime 采用 Sidecar 架构

## 状态

已采纳

## 上下文

AgentHub 是一个以 IM 聊天为核心交互范式的多 Agent 协作平台。系统分为三层：

- `web/`：前端 UI
- `hub-server/`：平台后端（业务状态管理）
- `agent-runtime/`：AI 执行引擎

在早期设计中，agent-runtime 被描述为"可以作为独立进程运行，也可以在早期作为 API Server 内部模块运行"。这种表述过于模糊，不利于明确职责边界和部署模型。

需要明确 agent-runtime 的进程模型，以支持：

- 生产环境的一键部署
- 进程生命周期的统一管理
- 执行环境与业务状态的隔离
- 未来支持本地进程管理、桌面端集成和远程执行

## 决策

agent-runtime 定位为 AgentHub 应用（含 Web + HubServer）的**侧车进程（Sidecar）**。

核心规则：

1. **生产环境**：HubServer 启动时，自动通过子进程方式拉起 agent-runtime，并传入必要参数（端口、回调地址、工作目录等）。
2. **开发环境**：支持手动独立启动 agent-runtime，便于调试和热重载。
3. **生命周期绑定**：agent-runtime 的生命周期由 HubServer 管理，包括启动、健康检查、自动重启和优雅关闭。
4. **进程隔离**：agent-runtime 作为独立进程运行，拥有独立的端口和工作目录，与 HubServer 通过 HTTP API 通信。

架构示意：

```text
生产环境：

HubServer (主进程)
  ├── 启动时 spawn agent-runtime (Sidecar 子进程)
  ├── 传入参数：--port, --hub-callback, --workdir, ...
  ├── 等待 /health 就绪
  ├── 业务请求 → HTTP → agent-runtime
  └── 退出时 SIGTERM → agent-runtime 优雅关闭

开发环境：

终端1: cd hub-server && bun dev
终端2: cd agent-runtime && bun dev
```

## 影响

### 正面影响

- **部署简单**：用户只需启动 HubServer，自动拉起 agent-runtime，无需手动管理两个进程。
- **进程隔离**：agent-runtime 崩溃不影响 HubServer 的业务状态，可自动重启。
- **职责清晰**：HubServer 管理状态和生命周期，agent-runtime 专注执行。
- **未来可扩展**：Sidecar 模式便于后续支持容器化部署、远程执行环境或桌面端集成。

### 风险与缓解

| 风险 | 缓解措施 |
| --- | --- |
| 进程间通信延迟 | 使用 localhost HTTP，延迟可忽略；后续可升级为 Unix Socket |
| agent-runtime 启动失败 | HubServer 实现健康检查轮询 + 超时回退 + 错误上报 |
| 异常退出 | HubServer 监听子进程 exit 事件，实现自动重启（带退避策略） |
| 端口冲突 | agent-runtime 支持端口 0 自动分配，或由 HubServer 指定可用端口 |

## 后续工作

1. HubServer 实现 Sidecar 管理器（启动、监控、重启、关闭）。
2. agent-runtime 实现标准化的 `/health` 端点和优雅关闭逻辑。
3. 定义 Sidecar 启动参数规范和通信契约。
4. 更新相关架构文档和 API 契约文档。
