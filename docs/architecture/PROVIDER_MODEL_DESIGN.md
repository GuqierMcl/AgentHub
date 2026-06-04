# Provider/Model 配置管理设计文档

> 本文档描述 AgentHub agent-runtime 中"LLM 提供商（Provider）与模型（Model）"配置管理的架构设计。
> 参考实现：NexPilot ai-engine (Python/FastAPI)

---

## 1. 术语与目标

### 1.1 术语

- **Provider（提供商）**：LLM 服务提供方，如 `openai`、`anthropic`、`deepseek` 等。每个 provider 有唯一的 `provider_id`。
- **Model（模型）**：某个 provider 下的具体模型，如 `gpt-4o`、`claude-sonnet-4` 等。由 `(provider_id, model_id)` 二元组唯一标识。
- **models.dev**：外部的 provider+model 元数据目录，提供 `/api.json`，包含模型能力、价格、上下文长度、默认 API 端点等信息。
- **Preset catalog（预设目录）**：从 models.dev 同步并缓存的 provider+model 元数据基线。
- **User config（用户配置）**：用户通过前端 UI 设置的 API Key、启用状态、自定义 provider/model，持久化到 `providers.json`。

### 1.2 设计目标

1. **统一模型目录**：以 models.dev 为预设基线，用户可扩展自定义 provider/model。
2. **JSON 存储**：使用 JSON 文件而非 SQLite，适合配置类数据的整体读写。
3. **可离线/可缓存**：本地缓存，无网络时使用已有缓存数据（首次启动除外）。
4. **环境变量注入数据目录**：数据目录由 `--data-dir` 参数或 `AGENT_RUNTIME_DATA_DIR` 环境变量注入。
5. **LLM 兼容**：支持 OpenAI 原生、Anthropic 原生、OpenAI 兼容（覆盖其余所有 provider）。

---

## 2. 架构总览

### 2.1 进程启动与数据目录

```
调用程序（父进程）
    │
    │  spawn("agent-runtime", args={
    │    --data-dir: /path/to/data/agent-runtime/
    │    --port: 4096
    │    --hostname: 127.0.0.1
    │  })
    │
    ▼
agent-runtime (子进程)
    │
    │  读取 --data-dir 参数或 AGENT_RUNTIME_DATA_DIR 环境变量
    │  → dataDir = resolve(args.data-dir || env.AGENT_RUNTIME_DATA_DIR || "./data")
    │
    │  dataDir/
    │  ├── catalog.json      ← models.dev 缓存
    │  └── providers.json    ← 用户配置
```

### 2.2 数据流

```
启动
 │
 ▼
① catalog.get() — 加载 models.dev 目录
 │  内存缓存 → 本地文件 → 在线拉取 → 空
 │
 ▼
② fromModelsDevProvider() — 标准化为内部结构
 │  raw JSON → ProviderInfo + ProviderModel
 │
 ▼
③ applyUserConfig() — 合并用户配置
 │  providers.json → 注入 api_key / enabled / 自定义模型
 │
 ▼
④ ProviderService 就绪 — 对外暴露查询接口
```

---

## 3. 数据来源与优先级

### 3.1 两层数据

| 层 | 来源 | 文件 | 生命周期 |
|----|------|------|---------|
| Preset catalog | models.dev | `catalog.json` | 程序刷新（TTL + 手动） |
| User config | 用户 UI 操作 | `providers.json` | 用户 CRUD |

### 3.2 合并规则

```
最终 provider 集 = preset catalog（标准化后） + user config（overlay）
```

- **preset catalog** 提供 provider/model 的元数据基线（名称、能力、价格、上下文长度等）
- **user config** 提供运行时可用性信息（API Key、启用状态、自定义 endpoint）
- **user config 中的自定义 provider** 不在 preset catalog 中，直接创建新的 ProviderInfo

---

## 4. models.dev 接入与缓存

### 4.1 同步策略

| 时机 | 行为 |
|------|------|
| 启动时 | 检查 `catalog.json` 的 mtime，TTL 未过期则跳过；过期则在线拉取 |
| 手动刷新 | 前端调用 `POST /catalog/refresh`，强制在线拉取 |

### 4.2 缓存回退链

```
内存缓存（memoryCache 变量）
    │
    ├─ 有 → 直接返回
    │
    └─ 无 → 读取 catalog.json 文件
         │
         ├─ 存在且有效 → 加载到内存并返回
         │
         └─ 不存在或损坏 → 在线拉取 models.dev/api.json
              │
              ├─ 成功 → 写入 catalog.json → 返回
              │
              └─ 失败 → 返回空 {}（无预设 provider）
```

> 注意：不维护内置快照文件。联网失败时仅返回空目录，用户仍可通过自定义 provider 使用 LLM。

### 4.3 缓存参数

| 参数 | 值 | 说明 |
|------|-----|------|
| TTL | 3600 秒（1 小时） | 桌面 App 不需要分钟级更新 |
| 在线拉取超时 | 10 秒 | 避免阻塞启动 |

---

## 5. 存储格式

### 5.1 catalog.json

直接存储 models.dev 的原始 JSON 响应，不做转换。结构为：

```json
{
  "openai": {
    "id": "openai",
    "name": "OpenAI",
    "npm": "@ai-sdk/openai",
    "api": "https://api.openai.com/v1",
    "env": ["OPENAI_API_KEY"],
    "doc": "https://platform.openai.com/docs",
    "models": {
      "gpt-4o": {
        "id": "gpt-4o",
        "name": "GPT-4o",
        "attachment": true,
        "reasoning": false,
        "tool_call": true,
        "release_date": "2024-05-13",
        "modalities": { "input": ["text", "image"], "output": ["text"] },
        "limit": { "context": 128000, "output": 16384 },
        "cost": { "input": 2.5, "output": 10 }
      }
    }
  }
}
```

> `npm` 字段用于推导 `ProviderInfo.api_protocol`（见 Section 6.2），不直接存储。

### 5.2 providers.json

用户配置文件，结构为：

```json
{
  "openai": {
    "api_key": "sk-...",
    "enabled": true
  },
  "anthropic": {
    "api_key": "sk-ant-...",
    "enabled": true
  },
  "deepseek": {
    "api_key": "sk-...",
    "enabled": true,
    "api_base": "https://api.deepseek.com/v1"
  },
  "my-custom": {
    "name": "My Custom Provider",
    "api_base": "https://my-proxy.example.com/v1",
    "api_key": "custom-key",
    "enabled": true,
    "models": {
      "my-model": {
        "name": "My Fine-tuned Model",
        "upstream_id": "gpt-4o-ft-abc123",
        "context_length": 32000,
        "supports_tools": true,
        "supports_vision": false
      }
    }
  }
}
```

---

## 6. 内部数据模型

### 6.1 TypeScript 定义（`types.ts`）

```typescript
type ProviderProtocol = "openai" | "anthropic" | "openai_compatible"

interface ModelCapabilities {
  supports_tools: boolean
  supports_vision: boolean
  supports_reasoning: boolean
  temperature: boolean
}

interface ModelCost {
  input: number    // per 1M tokens
  output: number
}

interface ProviderModel {
  id: string               // 模型唯一 ID（如 "gpt-4o"）
  provider_id: string      // 所属 provider（如 "openai"）
  upstream_id: string      // 实际发送给 API 的 model id
  name: string             // 显示名
  context_length: number
  output_length: number
  capabilities: ModelCapabilities
  cost: ModelCost
  source: "preset" | "custom"
  enabled: boolean
}

interface ProviderInfo {
  id: string
  name: string
  api_base: string
  api_key: string | null
  enabled: boolean
  source: "preset" | "custom"
  api_protocol: ProviderProtocol
  models: Record<string, ProviderModel>
}
```

### 6.2 models.dev → 内部结构映射

| models.dev 字段 | 内部字段 | 说明 |
|----------------|---------|------|
| `provider.id` | `ProviderInfo.id` | 直接使用 |
| `provider.name` | `ProviderInfo.name` | 直接使用 |
| `provider.api` | `ProviderInfo.api_base` | 默认 API 地址 |
| `provider.npm` | `ProviderInfo.api_protocol` | 推导映射：`@ai-sdk/openai` → `"openai"`，`@ai-sdk/anthropic` → `"anthropic"`，`@ai-sdk/openai-compatible` → `"openai_compatible"`；不支持的 npm 值的 provider 将被过滤 |
| `provider.env` | （不存储） | 仅作为参考信息，不注入 |
| `model.id` | `ProviderModel.upstream_id` | 实际发给 API 的 model id |
| `model.name` | `ProviderModel.name` | 显示名 |
| `model.tool_call` | `ModelCapabilities.supports_tools` | 直接映射 |
| `model.reasoning` | `ModelCapabilities.supports_reasoning` | 直接映射 |
| `model.attachment` + `modalities.input` | `ModelCapabilities.supports_vision` | 有 image/video/pdf 即为 True |
| `model.temperature` | `ModelCapabilities.temperature` | 直接映射 |
| `model.limit.context` | `ProviderModel.context_length` | 直接映射 |
| `model.limit.output` | `ProviderModel.output_length` | 直接映射 |
| `model.cost.input/output` | `ModelCost.input/output` | 直接映射 |
| `model.npm` | （丢弃） | TypeScript 不需要 |
| `model.interleaved` | （丢弃） | 内部处理 |
| `model.experimental` | （丢弃） | MVP 不需要 |
| `model.status` | （保留参考） | deprecated 模型可过滤 |

---

## 7. ProviderService

### 7.1 初始化管线

```typescript
async initialize():
    ① rawCatalog = await catalog.get()
    ② for (const [providerId, raw] of Object.entries(rawCatalog)) {
           const info = this.fromModelsDevProvider(providerId, raw)
           this.providers.set(providerId, info)
           for (const [modelId, model] of Object.entries(info.models)) {
               this.models.set(`${providerId}/${modelId}`, model)
           }
       }
    ③ userConfig = await this.loadUserConfig()
    ④ this.applyUserConfig(userConfig)
```

### 7.2 对外接口

| 方法 | 说明 |
|------|------|
| `listProviders(enabledOnly?)` | 列出所有 provider |
| `getProvider(providerId)` | 获取 provider 详情 |
| `getModel(providerId, modelId)` | 获取具体模型 |
| `getAvailableModels()` | 获取所有可用模型（有 key 且 enabled） |
| `updateProviderConfig(providerId, config)` | 更新配置并持久化 |
| `updateModelConfig(providerId, modelId, config)` | 更新模型配置并持久化 |
| `addCustomProvider(...)` | 添加自定义 provider |
| `updateCustomProvider(providerId, config)` | 更新自定义 provider |
| `removeCustomProvider(providerId)` | 删除自定义 provider |
| `refreshCatalog()` | 刷新 models.dev 目录 |

---

## 8. LLM 兼容策略

### 8.1 三类 Provider

| 类型 | 判断条件 | AI SDK 实现 |
|------|---------|------------|
| OpenAI 原生 | `provider.api_protocol == "openai"` | `@ai-sdk/openai` |
| Anthropic 原生 | `provider.api_protocol == "anthropic"` | `@ai-sdk/anthropic` |
| OpenAI 兼容 | `provider.api_protocol == "openai_compatible"`（含所有自定义 provider） | `@ai-sdk/openai-compatible` |

### 8.2 用户自定义 Provider

用户自定义的 provider 强制 `api_protocol = "openai_compatible"`，走 OpenAI 兼容模式：

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

const provider = createOpenAICompatible({
  name: 'my-custom',
  baseURL: 'https://my-proxy.example.com/v1',
  apiKey: 'custom-key',
})

const model = provider('my-model')
```

覆盖场景：Ollama、vLLM、DeepSeek、Moonshot、Qwen、Groq、OpenRouter、自建代理等。

---

## 9. API 端点

### 9.1 Provider 查询

```
GET /providers
    → 返回所有 provider 列表（含 models）
    Query: enabled_only=true (可选)

GET /providers/{provider_id}
    → 返回 provider 详情 + 模型列表
```

### 9.2 Provider 配置

```
PUT /providers/{provider_id}/config
    Body: { "api_key": "...", "enabled": true, "api_base": "..." }
    → 更新配置并持久化

PUT /providers/{provider_id}/models/{model_id}/config
    Body: { "enabled": true/false }
    → 更新模型启用状态
```

### 9.3 自定义 Provider

```
POST /custom-providers
    Body: { "id": "...", "name": "...", "api_base": "...", "api_key": "...", "models": {...} }
    → 创建自定义 provider

PUT /custom-providers/{provider_id}
    Body: { "name": "...", "api_base": "...", "api_key": "...", "models": {...} }
    → 更新自定义 provider

DELETE /custom-providers/{provider_id}
    → 删除自定义 provider
```

### 9.4 目录刷新

```
POST /catalog/refresh
    → 强制从 models.dev 刷新目录
```

---

## 10. 目录结构

```
agent-runtime/src/provider/
├── index.ts                 # 模块入口，导出核心类型和服务
├── types.ts                 # TypeScript 接口和 Zod 模式定义
├── catalog.ts               # models.dev 拉取 + TTL 缓存
└── service.ts               # ProviderService（初始化 + 合并 + CRUD）

agent-runtime/src/routers/
└── providers.ts             # Provider API 路由
```

---

## 11. 关键设计决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 存储格式 | JSON 文件 | 配置数据整体读写，不需要关系查询 |
| 数据目录 | `--data-dir` 参数 / `AGENT_RUNTIME_DATA_DIR` 环境变量 | 灵活配置，支持命令行和环境变量 |
| models.dev 缓存 TTL | 1 小时 | 桌面 App 不需要分钟级更新 |
| 文件锁 | 不需要 | 桌面 App 单进程，无多实例竞争 |
| 数据验证 | Zod | TypeScript 类型安全，运行时验证 |
| 路由框架 | Hono | 轻量级，支持多运行时 |
| npm 过滤策略 | 仅支持 `@ai-sdk/openai`、`@ai-sdk/anthropic`、`@ai-sdk/openai-compatible` | 不支持的 npm 值的 provider 在初始化时过滤 |
| 协议路由 | 基于 `ProviderInfo.api_protocol` 而非硬编码 provider ID | 解耦 provider ID 与协议实现 |

---

## 12. 与 Python 实现的对比

| 特性 | Python (ai-engine) | TypeScript (agent-runtime) |
|------|-------------------|---------------------------|
| Web 框架 | FastAPI | Hono |
| 数据验证 | Pydantic | Zod |
| LLM SDK | LangChain | Vercel AI SDK |
| 类型系统 | Python 类型提示 | TypeScript 接口 |
| 异步模型 | asyncio | async/await (Bun) |
| 配置注入 | Tauri 环境变量 | 命令行参数 / 环境变量 |

---

## 13. 未来扩展

### 13.1 自定义 Anthropic Provider

未来计划支持自定义 Anthropic 协议 provider：

- `CustomProviderCreateRequest` 增加可选 `api_protocol` 字段
- 自定义 provider 的 `api_protocol` 由用户指定，而非强制 `openai_compatible`
- 前端自定义 provider 表单新增"协议类型"下拉选择

### 13.2 模型别名

支持为模型设置别名，方便用户使用自定义名称。

### 13.3 使用统计

记录每个模型的使用次数、token 消耗等统计信息。