# AgentHub

AgentHub 是一个以 IM 聊天为核心交互范式的多 Agent 协作平台。用户可以像使用聊天软件一样，与不同 Agent 单聊或群聊，并在聊天流中查看文本、代码、Diff、网页预览、文件附件和部署状态等产物。

## 目录结构

```text
web/             前端项目，负责 IM 聊天界面与产物预览
hub-server/      API Server，负责会话、消息、Agent 配置和业务状态
agent-runtime/   Agent 执行运行时，负责编排、适配器、工具调用和产物生成
docs/            产品、架构、接口契约与 ADR 文档
```

系统调用边界：

```text
web -> hub-server -> agent-runtime
```

## 开发命令

```bash
# 前端
bun run dev:web

# API Server
bun run dev:server
```

`agent-runtime` 仍处于设计与脚手架阶段，命令以 `docs/architecture/AGENT_RUNTIME.md` 为准。

## 文档

开发前请先阅读 [docs/README.md](docs/README.md)。每次修改架构、接口契约、权限、编排逻辑或产物协议时，需要同步更新 `docs/` 中的对应文档。
