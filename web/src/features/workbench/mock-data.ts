import type { Agent, Conversation, CurrentUser } from "./types"

export const currentUser: CurrentUser = {
  initials: "顾",
  name: "顾七儿",
  plan: "Pro",
}

export const agents: Agent[] = [
  {
    id: "codex",
    name: "Codex",
    shortName: "Cx",
    role: "代码生成与仓库修改",
    status: "online",
    capabilities: ["React", "Diff", "Tests"],
  },
  {
    id: "claude",
    name: "Claude Code",
    shortName: "CC",
    role: "复杂任务规划与重构",
    status: "busy",
    capabilities: ["Planning", "Refactor", "Review"],
  },
  {
    id: "opencode",
    name: "OpenCode",
    shortName: "OC",
    role: "终端任务与本地执行",
    status: "idle",
    capabilities: ["Shell", "Workspace", "Patch"],
  },
  {
    id: "orchestrator",
    name: "Orchestrator",
    shortName: "Or",
    role: "多 Agent 协调器",
    status: "online",
    capabilities: ["Split", "Assign", "Merge"],
  },
]

export const conversations: Conversation[] = [
  {
    id: "ui-shell",
    title: "AgentHub 静态 IM 壳",
    mode: "single",
    agentIds: ["codex"],
    preview: "左侧会话、右侧聊天和内联产物卡片已收敛。",
    activeAt: "09:42",
    unread: 2,
    pinned: true,
    messages: [
      {
        id: "m1",
        role: "user",
        text: "基于文档先做一个静态 Web 界面，不接后端。布局要像微信，左侧是会话记录，右侧是当前对话。",
        time: "09:20",
      },
      {
        id: "m2",
        role: "assistant",
        agentId: "codex",
        text: "我会把界面收敛成一个清爽的两栏 Workbench：左侧负责会话导航，右侧负责当前消息流。Artifact 只作为消息里的紧凑附件出现，避免信息噪音。",
        time: "09:22",
        sources: [
          {
            href: "https://react.dev/reference/react",
            title: "React Documentation",
          },
          {
            href: "https://ai-sdk.dev/elements",
            title: "AI Elements",
          },
        ],
        tools: [
          {
            id: "tool-search",
            description: "Searching component references",
            name: "mcp",
            parameters: {
              query: "AI Elements conversation message prompt-input",
              source: "local registry",
            },
            result: `{
  "components": ["Conversation", "Message", "PromptInput"],
  "status": "available"
}`,
            status: "output-available",
          },
        ],
        artifacts: [
          {
            id: "artifact-preview",
            type: "preview",
            title: "Web preview",
            description: "静态预览入口，后续可挂载 iframe 或构建产物。",
            meta: "P1 artifact",
          },
          {
            id: "artifact-diff",
            type: "diff",
            title: "UI shell diff",
            description: "展示一键应用 Diff 的占位状态，不执行真实修改。",
            meta: "+124 -18",
          },
        ],
      },
      {
        id: "m3",
        role: "user",
        text: "输入框这轮只要静态，不要调用 API。",
        time: "09:31",
        versions: [
          {
            id: "m3-v1",
            content: "输入框这轮只要静态，不要调用 API。",
          },
          {
            id: "m3-v2",
            content:
              "输入框可以展示附件、搜索、模型选择和语音入口，但不要真的发请求。",
          },
          {
            id: "m3-v3",
            content:
              "请把官网示例里的分支消息、sources、reasoning、attachments 和 composer 工具都静态展示出来。",
          },
        ],
      },
      {
        id: "m4",
        role: "assistant",
        agentId: "codex",
        text: `## 静态 AI Elements 覆盖面

当前页面会静态覆盖：

- Conversation / ConversationContent / ConversationScrollButton
- Message / MessageContent / MessageResponse
- MessageBranch / MessageBranchSelector
- Sources 和 Source
- Reasoning 折叠面板
- Tool 调用展示
- PromptInput、Attachments、SpeechInput、Suggestion、ModelSelector

这些组件都只在前端本地渲染，不接入后端。`,
        time: "09:34",
        reasoning: {
          content:
            "用户希望通过静态页面尽可能暴露 AI Elements 组件的问题，因此应覆盖更多官方示例中的组件组合，但仍然保持 Workbench 结构清晰。",
          duration: 8,
        },
        artifacts: [
          {
            id: "artifact-code",
            type: "code",
            title: "Prompt input",
            description: "使用已安装的 AI Elements PromptInput 组件。",
            meta: "React TSX",
          },
        ],
      },
    ],
  },
  {
    id: "group-orchestration",
    title: "多 Agent 群聊编排",
    mode: "group",
    agentIds: ["orchestrator", "claude", "codex", "opencode"],
    preview: "Orchestrator 已拆分任务：规划、实现、验证。",
    activeAt: "昨天",
    pinned: true,
    messages: [
      {
        id: "g1",
        role: "user",
        text: "@Orchestrator 帮我拆一下接入两个外部 Agent 的工作。",
        time: "14:08",
      },
      {
        id: "g2",
        role: "assistant",
        agentId: "orchestrator",
        text: "任务会分成三段：Claude Code 负责接口设计，Codex 负责适配器实现，OpenCode 负责本地命令和权限检查验证。",
        time: "14:09",
        artifacts: [
          {
            id: "artifact-run",
            type: "deploy",
            title: "Run status",
            description: "3 个子任务排队中，等待用户确认权限策略。",
            meta: "Pending",
          },
        ],
      },
    ],
  },
  {
    id: "artifact-preview",
    title: "网页产物预览",
    mode: "single",
    agentIds: ["claude"],
    preview: "内联网页预览卡片与代码编辑入口设计。",
    activeAt: "周二",
    archived: true,
    messages: [
      {
        id: "a1",
        role: "assistant",
        agentId: "claude",
        text: "产物预览应该出现在聊天流内，点击后再进入全屏预览或编辑。",
        time: "16:12",
        artifacts: [
          {
            id: "artifact-web",
            type: "preview",
            title: "Landing preview",
            description: "静态网页预览卡片，支持后续扩展为 iframe。",
            meta: "web artifact",
          },
        ],
      },
    ],
  },
]

export const suggestedPrompts = [
  "What are the latest trends in AI?",
  "How does machine learning work?",
  "Explain quantum computing",
  "Best practices for React development",
  "Tell me about TypeScript benefits",
  "How to optimize database queries?",
]

export const modelOptions = [
  {
    chef: "OpenAI",
    chefSlug: "openai",
    id: "gpt-4o",
    name: "GPT-4o",
    providers: ["openai", "azure"],
  },
  {
    chef: "OpenAI",
    chefSlug: "openai",
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    providers: ["openai", "azure"],
  },
  {
    chef: "Anthropic",
    chefSlug: "anthropic",
    id: "claude-opus-4-20250514",
    name: "Claude 4 Opus",
    providers: ["anthropic", "azure", "google", "amazon-bedrock"],
  },
  {
    chef: "Google",
    chefSlug: "google",
    id: "gemini-2.0-flash-exp",
    name: "Gemini 2.0 Flash",
    providers: ["google"],
  },
]

export const modelChefs = ["OpenAI", "Anthropic", "Google"]

export function getAgentById(agentId?: string) {
  return agents.find((agent) => agent.id === agentId)
}
