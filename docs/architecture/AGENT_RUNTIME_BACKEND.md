# Agent Runtime Backend 设计

本文档定义 Agent Runtime 的 Workspace / Filesystem Backend 抽象。它描述了 Runtime 如何通过可插拔后端访问文件系统，以及如何在用户显式指定沙箱外目录或文件时，通过审批机制安全地扩展访问范围。

## 1. 目标

- 文件能力不是直接绑定本地磁盘，而是绑定到抽象的 Workspace Backend。
- 第一版优先落地本地文件系统后端，但接口必须允许后续替换为远程、SSH、容器、Git worktree 等后端。
- 文件工具只面对统一的 workspace-relative 路径，不直接接触宿主机绝对路径。
- 用户可以显式指定沙箱外的目录或文件，但必须先走审批。
- `read_file` 需要原生支持图片文件的多模态读取，至少包括 `.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`。
- 路径解析、权限控制、审计、快照与回滚都应位于 Backend / Sandbox 层，而不是散落在工具实现里。

## 2. 核心分层

推荐分层如下：

```text
Tool
  ↓
WorkspaceService
  ↓
SandboxPolicy / AccessGrant
  ↓
WorkspaceBackend
```

### 2.1 Tool

`ls`、`read_file`、`write_file`、`edit_file`、`glob`、`grep` 等工具只负责表达意图，不直接操作文件系统。

### 2.2 WorkspaceService

WorkspaceService 负责：

- 解析逻辑路径。
- 检查是否位于当前 workspace 或已批准挂载点内。
- 调用对应 backend 执行操作。
- 统一返回文本、图片、错误、审计信息。

### 2.3 SandboxPolicy

SandboxPolicy 负责决定“能不能访问”：

- 是否允许读。
- 是否允许写。
- 是否允许访问外部目录或文件。
- 是否需要审批。
- 是否允许敏感文件。

### 2.4 WorkspaceBackend

WorkspaceBackend 负责决定“怎么访问”：

- 本地磁盘。
- 远程文件系统。
- SSH。
- 容器挂载目录。
- Git worktree。

Backend 不应该自己决定业务权限；它只暴露能力和执行原语。

## 3. 标准工具面

第一批文件工具建议抽象为：

- `ls`
- `read_file`
- `write_file`
- `edit_file`
- `glob`
- `grep`

### 3.1 路径约束

这些工具默认只接受 workspace-relative 路径，例如：

```text
src/index.ts
docs/AGENT_RUNTIME.md
assets/logo.png
```

不接受宿主机绝对路径作为常规输入。

### 3.2 `read_file`

- 文本文件返回文本块。
- 图片文件返回多模态 content blocks。
- 二进制文件默认不直接按原文透出，除非 backend 明确支持。

推荐返回结构：

```ts
type ToolContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string; encoding: "base64" }
```

### 3.3 `edit_file`

`edit_file` 建议以局部编辑或 patch 的语义实现，而不是简单整文件覆盖。

### 3.4 `grep` 与 `glob`

- `glob` 用于候选文件定位。
- `grep` 用于内容检索，结果应包含文件路径、行号和片段。

## 4. Workspace 模型

一个 Run 至少绑定一个主 workspace。

```ts
type WorkspaceHandle = {
  workspaceId: string
  backendType: string
  rootLabel: string
}
```

第一版建议：

- 一个 Run 默认只有一个主 workspace。
- 允许附加若干外部访问授权挂载点。
- 外部目录或文件不是“直接越界访问”，而是以受控 mount / grant 的形式加入当前 workspace。

## 5. Backend 接口

建议的后端能力接口如下：

```ts
type WorkspaceBackendCapabilities = {
  read: boolean
  write: boolean
  edit: boolean
  list: boolean
  glob: boolean
  grep: boolean
  imageRead: boolean
  snapshots: boolean
  externalMounts: boolean
}

type WorkspaceBackend = {
  type: string
  capabilities(): WorkspaceBackendCapabilities
  resolve(path: string): Promise<string>
  readFile(path: string): Promise<{ blocks: ToolContentBlock[] }>
  writeFile(path: string, content: string): Promise<void>
  editFile(path: string, patch: string): Promise<void>
  listFiles(path: string): Promise<Array<{ path: string; kind: "file" | "dir" }>>
  glob(pattern: string): Promise<string[]>
  grep(pattern: string, path: string): Promise<Array<{ path: string; line: number; snippet: string }>>
  createSnapshot?(): Promise<{ snapshotId: string }>
  restoreSnapshot?(snapshotId: string): Promise<void>
}
```

说明：

- `resolve` 必须做规范化和边界检查。
- `readFile` / `writeFile` / `editFile` / `grep` 是否支持，由 `capabilities()` 说明。
- 外部挂载是否支持，由 `externalMounts` 决定。

## 6. 路径解析与安全

所有路径必须经过“解析后校验”：

1. 规范化路径。
2. 拒绝绝对路径直达。
3. 拒绝 `..` 越界。
4. 解析符号链接后再次校验边界。
5. 检查是否命中受限文件规则。
6. 再交给 backend 执行。

默认拒绝的敏感目标建议包括：

- `.env`
- `*.pem`
- `*.key`
- `id_rsa`
- `node_modules/.cache` 之外的系统敏感目录
- 系统用户主目录中的凭据文件

## 7. 沙箱外目录与文件

这是本设计的关键点。

### 7.1 原则

- 用户可以显式指定沙箱外的目录或文件。
- 访问前必须产生审批请求。
- 审批通过后，不直接开放“整个宿主机文件系统”，而是创建一个受控的外部访问授权。
- 授权必须是范围明确、时间受限、可撤销的。

### 7.2 请求语义

当用户或 agent 明确请求访问沙箱外路径时，Runtime 应创建一个 `ExternalAccessRequest`。

```ts
type ExternalAccessRequest = {
  requestId: string
  runId: string
  workspaceId: string
  targetPath: string
  targetKind: "file" | "directory"
  accessMode: "read" | "write"
  reason: string
  expiresAt?: string
}
```

### 7.3 审批事件

请求触发时，Runtime 应输出 `permission.requested` 事件，供 HubServer/UI 展示并收集审批结果。

建议携带：

- `requestId`
- `targetPath`
- `targetKind`
- `accessMode`
- `reason`
- `riskLevel`

### 7.4 审批后的访问方式

审批通过后，Runtime 不把真实绝对路径直接暴露给工具，而是创建一个外部授权挂载点：

```ts
type ExternalAccessGrant = {
  grantId: string
  requestId: string
  mountId: string
  targetPath: string
  targetKind: "file" | "directory"
  accessMode: "read" | "write"
  expiresAt?: string
}
```

挂载行为建议如下：

- 目录授权：挂载为独立只读或读写子 workspace。
- 文件授权：挂载为仅包含单个文件的受控虚拟目录，或等价的单文件句柄。
- 默认只读。
- 写入需要单独批准，且仅在 backend 支持时开放。

### 7.5 用户体验建议

如果 agent 请求访问沙箱外路径：

- 先展示明确的审批理由。
- 说明访问范围是单文件还是目录。
- 说明是只读还是读写。
- 说明授权有效期。
- 允许用户撤销。

## 8. 本地优先实现

第一版优先落地 `LocalWorkspaceBackend`：

- 工作区根目录来自 Runtime 配置或上层服务传入。
- 所有文件工具都围绕本地 workspace root 工作。
- 外部目录或文件通过外部授权挂载加入本地 workspace 视图。
- 工具层不直接调用 `node:fs`，而是统一走 WorkspaceService。

## 9. 未来可插拔后端

后续可扩展为：

- `LocalWorkspaceBackend`
- `RemoteWorkspaceBackend`
- `SshWorkspaceBackend`
- `GitWorktreeBackend`
- `ContainerWorkspaceBackend`

这些后端应满足同一套接口，不应改变工具协议。

## 10. 审计与事件

建议至少记录：

- 谁发起了访问请求。
- 请求访问了什么路径。
- 目标是文件还是目录。
- 是读还是写。
- 是否审批通过。
- 最终由哪个 backend 执行。

文件工具本身不负责审计持久化，但必须把关键元数据带到事件流里。

## 11. 不纳入范围

本设计不负责：

- 前端审批交互细节。
- 文件 diff UI 细节。
- 具体远程协议实现。
- 沙箱外路径的默认全局开放。
- 直接暴露宿主机绝对路径给 agent。

## 12. 已锁定决策

- Backend 是能力接口，不是工具实现本身。
- 本地文件系统优先落地，但不是唯一实现。
- `read_file` 需要支持图片的多模态返回。
- 用户显式指定沙箱外目录或文件时，必须先审批。
- 审批通过后以受控授权挂载的方式暴露访问，不直接放开整机文件系统。
- 工具只处理 workspace-relative 路径，真实绝对路径只存在于 backend 内部和审计记录中。
