# Agent Runtime

AgentHub 的 Agent 运行时服务，基于 Bun + Hono 构建。

## 安装依赖

```sh
bun install
```

## 开发环境

```sh
# 默认配置启动（端口 4096，主机名 127.0.0.1）
bun run dev

# 自定义端口和主机名
bun run dev -- --port 3000 --hostname 0.0.0.0

# 配置 CORS 来源
bun run dev -- --cors http://localhost:3000 --cors http://example.com

# 指定数据目录
bun run dev -- --data-dir /path/to/data
```

## 生产环境

```sh
# 构建可执行文件
bun run build

# 运行构建后的可执行文件
./dist/agent-runtime --port 8080 --hostname 0.0.0.0 --cors https://yourdomain.com --data-dir /var/lib/agent-runtime
```

## 启动参数

| 参数 | 短参数 | 说明 | 默认值 |
|------|--------|------|--------|
| `--port` | `-p` | 监听端口 | `4096` |
| `--hostname` | `-h` | 监听的主机名 | `127.0.0.1` |
| `--cors` | - | 额外允许的浏览器来源（可多次指定） | `[]` |
| `--data-dir` | `-d` | 持久化数据目录 | `./data` |

## 环境变量

支持通过环境变量配置，优先级：命令行参数 > 环境变量 > 默认值

| 环境变量 | 说明 |
|----------|------|
| `PORT` | 监听端口 |
| `HOSTNAME` | 监听的主机名 |
| `CORS` | 额外允许的浏览器来源（逗号分隔） |
| `AGENT_RUNTIME_DATA_DIR` | 持久化数据目录 |

### 环境变量使用示例

```sh
# Windows PowerShell
$env:PORT=3000; $env:HOSTNAME="0.0.0.0"; $env:CORS="http://localhost:3000,http://example.com"; $env:AGENT_RUNTIME_DATA_DIR="C:\data\agent-runtime"; bun run dev

# Linux/macOS
PORT=3000 HOSTNAME=0.0.0.0 CORS=http://localhost:3000,http://example.com AGENT_RUNTIME_DATA_DIR=/var/lib/agent-runtime bun run dev
```

## API 接口

| 路径 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 服务状态 |
| `/health` | GET | 健康检查 |

### 健康检查响应示例

```json
{
  "status": "ok",
  "timestamp": "2026-05-22T05:37:46.893Z",
  "uptime": 1.9981995
}
```

## 开发命令

```sh
# 开发环境（热重载）
bun run dev

# 构建可执行文件
bun run build

# 运行构建后的可执行文件
bun run start

# TypeScript 类型检查
bunx tsc --noEmit
```
