# `bash` Runtime Tool

`bash` 是 Agent Runtime 的命令执行工具。工具名固定为 `bash`，方便模型理解；但底层 shell 是平台 shell，Windows 默认使用 PowerShell，非 Windows 默认使用 `/bin/sh`。第一版使用 `execa` 执行非交互命令，不引入 PTY，也不支持长期后台进程管理。

## 工具契约

```ts
type BashInput = {
  command: string
  cwd?: string
  timeoutMs?: number
  maxOutputBytes?: number
  description?: string
}
```

默认值：

- `timeoutMs = 30000`，最大 `300000`。
- `maxOutputBytes = 131072`，最大 `1048576`，作为 stdout + stderr 合计传输上限。
- `cwd = "."`，解释为绑定 workspace 内的相对路径。

```ts
type BashResult = {
  command: string
  cwd: string
  shell: string
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  stdoutBytes: number
  stderrBytes: number
  truncated: boolean
  durationMs: number
}
```

非零退出码是正常工具完成，结果通过 `exitCode` 表达。spawn 失败、超时、取消、缺少 workspace、非法 `cwd`、权限拒绝才是工具失败。stdout/stderr 只保存截断后的文本；Runtime raw event 和产品 event 都不得保存无限输出。

## Shell 解析

解析顺序：

1. `AGENTHUB_BASH_SHELL` 指定可执行文件时使用该 shell。
2. `AGENTHUB_BASH_SHELL_ARGS` 可选 JSON 字符串数组，用作命令前置参数。
3. 未配置时，Windows 使用 `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command <command>`。
4. 未配置时，非 Windows 使用 `/bin/sh -lc <command>`。

默认 Windows PowerShell 执行前会把 `[Console]::InputEncoding`、`[Console]::OutputEncoding` 和 `$OutputEncoding` 设为 UTF-8，降低中文等非 ASCII 输出乱码概率。Runtime 捕获 stdout/stderr 时保留原始字节语义，优先按 UTF-8 解码；若不是合法 UTF-8，则按 Windows ANSI code page 兜底，例如中文系统常见的 936 会映射为 `gb18030`。可用 `AGENTHUB_BASH_OUTPUT_ENCODING` 强制指定输出解码，或用 `AGENTHUB_BASH_WINDOWS_CODE_PAGE` 覆盖 Windows code page 检测。

子进程使用环境变量白名单，不继承完整 Runtime 进程环境。`cwd` 必须是 workspace-relative 路径，Runtime 会解析真实路径并拒绝越过 workspace root 的路径。

## 权限规则

`bash` 的 Tool Catalog 元数据：

- `category = "shell"`
- `riskLevel = "high"`
- `requiredPermissions = { shell: "limited" }`
- `approvalPolicy = "contextual"`
- `configurableByUserAgent = false`

粗权限先由 `permissionPolicy.shell` 处理：`none` 直接返回 `TOOL_PERMISSION_DENIED`；`limited` 和 `full` 通过粗权限后继续应用命令级规则。

命令级规则在 Agent schema 中：

```ts
toolPermissionRules?: {
  bash?: Record<string, "allow" | "ask" | "deny">
}
```

规则按对象插入顺序匹配，最后一个匹配规则生效。匹配支持简单 wildcard：`*` 表示任意字符，`?` 表示单字符；匹配前会压缩空白，匹配大小写不敏感。

系统预设主智能体的默认规则：

```json
{
  "*": "ask",
  "pwd": "allow",
  "pwd *": "allow",
  "ls": "allow",
  "ls *": "allow",
  "dir": "allow",
  "dir *": "allow",
  "git status*": "allow",
  "git diff*": "allow",
  "git log*": "allow",
  "git branch*": "allow",
  "npm *": "ask",
  "bun *": "ask",
  "pnpm *": "ask",
  "yarn *": "ask",
  "rm *": "deny",
  "del *": "deny",
  "rmdir *": "deny",
  "Remove-Item *": "deny",
  "git reset*": "deny",
  "git clean*": "deny",
  "git push*": "deny",
  "shutdown*": "deny",
  "reboot*": "deny"
}
```

`allow` 直接执行；`deny` 在 `tool.started` 前输出 `tool.failed(BASH_COMMAND_DENIED)`；`ask` 先产生审批请求。批准后同一 `runId + toolCallId` 不重复审批。

## 审批 Payload

`ask` 规则产生 `permission.requested`，其中 Runtime permission request 的 `data` 包含：

```json
{
  "permissionType": "command_execute",
  "approvalReason": "bash_command",
  "command": "npm test",
  "cwd": ".",
  "matchedRule": "npm *",
  "ruleAction": "ask",
  "shell": "powershell.exe"
}
```

拒绝后 Runtime 输出 `permission.denied` 与 `tool.failed(TOOL_EXECUTION_DENIED)`，并把拒绝结果交回模型继续生成。

## 暴露范围

首版开放给内部预设主智能体：`orchestrator`、`coder`、`reviewer`、`writer`、`planner`。外部 `opencode` 保持 `allowedTools = []`，不注入 Runtime Tool。用户自定义智能体不能选择 `bash`，CRUD 对非空 `toolPermissionRules.bash` 返回 `AGENT_INVALID_INPUT`。

## 非目标范围

`bash` v1 不是 OS sandbox、容器 sandbox 或安全隔离边界。命令仍以 Agent Runtime 进程所在用户权限运行。当前边界是：Agent 粗权限、命令级规则、审批、workspace-relative `cwd` 校验、环境变量白名单、超时和输出截断。

首版不支持交互式 PTY、长期后台进程、session-level “always allow”、二进制输出解析、容器化执行、用户自定义智能体开放 shell，或跨 Run 的审批记忆。
