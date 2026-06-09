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
docs/architecture/AGENT_RUNTIME.md
assets/logo.png
```

宿主机绝对路径不是常规输入；当用户或上层明确传入绝对路径时，Runtime 必须把它视为沙箱外显式访问请求，先走审批，再以 scoped grant 暴露逻辑路径，不把绝对路径交给模型或普通工具事件。

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

`edit_file` 第一版采用精确 search/replace 语义：

```ts
type EditFileInput = {
  path: string
  search: string
  replace: string
  expectedReplacements?: number
}

type EditFileResult = {
  path: string
  size: number
  replacements: number
  changed: boolean
  diff?: {
    format: "unified"
    text: string
    truncated: boolean
    additions: number
    deletions: number
    contextLines: number
  }
}
```

默认 `expectedReplacements = 1`。匹配数量不符时工具失败且不修改文件。成功编辑 UTF-8 文本时，`edit_file` 会在成功结果中返回 workspace-relative 路径和一个 bounded unified diff，用于消息流内的轻量代码 diff 展示；diff 文本最多保留 32k 字符，超出时设置 `truncated = true`。该 per-tool diff 不替代 Run 级 Diff Artifact、撤销、apply 或代码审查流程。第一版仍不支持二进制编辑或自动创建父目录。

### 3.4 `grep` 与 `glob`

- `glob` 用于候选文件定位。
- `grep` 用于内容检索，结果应包含文件路径、行号和片段。

## 4. Workspace 模型

一个 Run 可以绑定一个主 workspace。未绑定 workspace 的 Run 仍可进行纯对话和非文件工具调用，但 `ls`、`read_file`、`write_file`、`edit_file`、`glob`、`grep` 等文件工具必须返回 `WORKSPACE_NOT_BOUND`，不得回退到 Runtime 全局 `config.workdir`。

```ts
type WorkspaceHandle = {
  workspaceId: string
  backendType: string
  rootLabel: string
  rootPath: string
}
```

第一版建议：

- 一个 Run 最多只有一个主 workspace，创建 Run 时由 `RunInput.workspace` 固定，执行过程中不可切换。
- `rootPath` 只存在于 Runtime 内部 session 与 backend 中；`GET /runtime/runs/:runId` 只返回 `workspaceId`、`backendType` 与 `rootLabel`。
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
  writeFile(path: string, content: string, options?: { overwrite?: boolean }): Promise<WorkspaceWriteFileResult>
  editFile(path: string, patch: WorkspaceEditFilePatch): Promise<WorkspaceEditFileResult>
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

当前敏感路径策略集中在 SandboxPolicy，至少包括：

- `.env`、`.env.*`
- `AGENTS.md`
- `.npmrc`
- `*.pem`
- `*.key`
- `id_rsa`
- `.git`、`.svn`、`.hg` 内部路径

读取规则：

- `read_file` 显式读取 workspace 内普通文件：直接执行。
- `read_file` 显式读取 workspace 内敏感文件：产生审批，批准后恢复原工具调用。
- `grep` 显式以敏感文件为搜索路径：产生审批，批准后执行。
- `ls` / `glob`：隐藏敏感文件和敏感目录，不因目录扫描批量申请审批。
- `grep` 递归搜索普通目录：跳过敏感文件；只有显式指定敏感文件路径时才申请审批。
- 外部目录 read grant 不自动解除敏感规则；后续显式读取该目录下敏感文件仍需单独审批。

写入规则：

- `write_file` / `edit_file` 需要 agent 具备 `filesystem: "write"`。
- workspace 内普通文件写入或编辑：直接执行，不逐次审批。
- workspace 内敏感文件写入或编辑：产生审批，批准后创建精确 scoped write grant 并恢复同一 Run。
- 沙箱外任何写入或编辑：产生审批，批准后创建 scoped write grant。
- 沙箱外敏感文件写入或编辑：只产生一次 combined approval，批准后创建可写且允许敏感文件的精确 grant。
- 读 grant 与写 grant 分离；读授权不能用于写入，写授权也不会跨 Run 复用。

## 7. 沙箱外目录与文件

这是本设计的关键点。

### 7.1 原则

- 用户可以显式指定沙箱外的目录或文件。
- 访问前必须产生审批请求。
- 审批通过后，不直接开放“整个宿主机文件系统”，而是创建一个受控的外部访问授权。
- 授权必须是范围明确、时间受限、可撤销的。

### 7.2 请求语义

当用户或 agent 明确请求访问沙箱外路径、显式读取敏感文件，或写入需要审批的路径时，Runtime 应创建统一的访问审批请求。当前代码中的内部类型仍沿用 `ExternalAccessRequest` 名称，但语义已经覆盖读写访问。

```ts
type ExternalAccessRequest = {
  requestId: string
  runId: string
  workspaceId: string
  targetPath: string
  targetKind: "file" | "directory"
  accessMode: "read" | "write"
  reason: string
  approvalReason:
    | "external_read"
    | "sensitive_read"
    | "external_sensitive_read"
    | "external_write"
    | "sensitive_write"
    | "external_sensitive_write"
  logicalPath: string
  expiresAt?: string
}
```

### 7.3 审批事件

请求触发时，`RuntimePermissionService` 输出 `permission.requested` 事件，Run 进入 `waiting_approval`。Runtime 内部 API 已可收集决定并恢复同一 Run；HubServer/UI 后续只需代理请求、呈现状态并提交用户决定。

建议携带：

- `requestId`
- `logicalPath`
- `targetKind`
- `accessMode`
- `reason`
- `riskLevel`

普通 RunEvent、工具成功结果和常规日志不得暴露 workspace root 或授权目录的真实绝对路径。审批记录内部可以保存真实路径用于 Runtime 审计和 grant 创建，但对 API 响应和事件只返回逻辑路径、访问模式与授权范围。

审批通过时发送 `permission.approved`，审批拒绝时发送 `permission.denied`；等待过程中取消 Run 时发送 `permission.cancelled`。审批尚未通过时对应工具不得发送 `tool.started`。

### 7.4 审批后的访问方式

审批通过后，Runtime 不把真实绝对路径直接暴露给工具，而是创建一个外部授权挂载点：

```ts
type ExternalAccessGrant = {
  grantId: string
  requestId: string
  mountId: string
  runId: string
  workspaceId: string
  targetPath: string
  targetKind: "file" | "directory"
  accessMode: "read" | "write"
  scope: "external" | "sensitive" | "external-sensitive"
  allowSensitive: boolean
  expiresAt?: string
}
```

挂载行为建议如下：

- 目录授权：挂载为独立只读或读写子 workspace。
- 文件授权：挂载为仅包含单个文件的受控虚拟目录，或等价的单文件句柄。
- 默认按审批请求的 `accessMode` 创建 read grant 或 write grant。
- 写入需要单独批准，且仅在 backend 支持 `write` / `edit` 时开放。
- grant 仅在创建它的 Run session 内有效，并校验 `runId`、`workspaceId`、访问模式、目标范围与有效期。
- 显式读取沙箱外敏感文件只产生一次 `external_sensitive_read` 审批；批准后创建 combined read grant，不连续弹两次审批。
- 显式写入沙箱外敏感文件只产生一次 `external_sensitive_write` 审批；批准后创建 combined write grant，不连续弹两次审批。

### 7.5 用户体验建议

如果 agent 请求访问沙箱外路径：

- 先展示明确的审批理由。
- 说明访问范围是单文件还是目录。
- 说明是只读还是读写。
- 说明授权有效期。
- 允许用户撤销。

## 8. 本地优先实现

第一版优先落地 `LocalWorkspaceBackend`：

- 工作区根目录来自每次 Run 的 `workspace.rootPath` snapshot；Runtime 校验其为已存在目录并使用 canonical real path，不自动创建目录。
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

## 13. 当前实现状态

截至本轮，Workspace Backend 已完成第一版落地：

- `LocalWorkspaceBackend` 已实现 workspace-relative 路径解析、越界拒绝、symlink 越界防护和敏感文件屏蔽。
- `WorkspaceService` 已改为每个 Run 独立创建 session，统一处理主 workspace、敏感读写、外部访问请求去重、审批通过后的 scoped read/write grant，以及路径到 backend 的分发。
- 文件工具 `ls`、`read_file`、`write_file`、`edit_file`、`glob`、`grep` 已接入 Runtime Tool Registry。
- `read_file` 已支持图片多模态返回。
- 沙箱外只读路径访问、workspace 内敏感文件显式读取、沙箱外敏感文件显式读取均已由 `RuntimePermissionService` 闭环：产生 `permission.requested`，进入 `waiting_approval`，经批准创建 read grant 后在同一 Run 恢复原执行分支，拒绝或取消产生对应权限终态事件。
- `write_file` / `edit_file` 已支持 UTF-8 文本写入和 search/replace 编辑；`edit_file` 成功结果会携带 bounded unified diff 供消息流展示。workspace 内普通文件修改无需审批，敏感写入和沙箱外写入通过 write grant 审批续跑闭环。
